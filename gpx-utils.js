/* GPX 解析与海拔剖面工具（纯客户端） */
'use strict';

const GPX_CACHE_KEY = 'outdoor_dashboard_gpx_cache';
const GPX_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

/** 去掉 XML 命名空间前缀，取本地标签名。 */
function gpxLocalName(node) {
  if (!node || !node.nodeName) return '';
  return String(node.nodeName).split(':').pop();
}

/** Haversine 球面距离，返回千米。 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** 从原始 GPX XML 文本解析轨迹点 [{lat, lon, ele, distanceKm}]。 */
function parseGpxXml(xmlText) {
  if (!xmlText || typeof xmlText !== 'string') return [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('GPX XML 解析失败');
  }

  const raw = [];
  // 优先用命名空间查询，再兜底遍历所有 trkpt
  let trkpts = doc.querySelectorAll('trkpt');
  if (!trkpts.length) {
    trkpts = doc.getElementsByTagNameNS('*', 'trkpt');
  }
  if (!trkpts.length) {
    // 兜底：遍历全部元素找以 trkpt 结尾的标签
    trkpts = Array.from(doc.getElementsByTagName('*')).filter((n) => gpxLocalName(n) === 'trkpt');
  }

  for (const pt of trkpts) {
    const lat = parseFloat(pt.getAttribute('lat'));
    const lon = parseFloat(pt.getAttribute('lon'));
    if (isNaN(lat) || isNaN(lon)) continue;

    let ele = 0;
    for (const child of pt.children) {
      if (gpxLocalName(child) === 'ele') {
        const v = parseFloat(child.textContent);
        if (!isNaN(v)) ele = v;
      }
    }
    raw.push({ lat, lon, ele });
  }

  if (!raw.length) return [];

  // 计算累计距离与爬升/下降
  const points = [];
  let distKm = 0;
  for (let i = 0; i < raw.length; i++) {
    if (i > 0) {
      distKm += haversineKm(raw[i - 1].lat, raw[i - 1].lon, raw[i].lat, raw[i].lon);
    }
    points.push({
      lat: raw[i].lat,
      lon: raw[i].lon,
      ele: raw[i].ele,
      distanceKm: distKm,
    });
  }
  return points;
}

/** 从轨迹点计算总距离、累计爬升/下降、最高/最低海拔。 */
function computeGpxStats(points) {
  if (!points || !points.length) {
    return { distanceKm: 0, gainM: 0, lossM: 0, minEleM: 0, maxEleM: 0, count: 0 };
  }
  let gainM = 0;
  let lossM = 0;
  let minEleM = points[0].ele;
  let maxEleM = points[0].ele;
  for (let i = 1; i < points.length; i++) {
    const diff = points[i].ele - points[i - 1].ele;
    if (diff > 0) gainM += diff;
    else lossM += Math.abs(diff);
    minEleM = Math.min(minEleM, points[i].ele);
    maxEleM = Math.max(maxEleM, points[i].ele);
  }
  return {
    distanceKm: points[points.length - 1].distanceKm,
    gainM: Math.round(gainM),
    lossM: Math.round(lossM),
    minEleM: Math.round(minEleM),
    maxEleM: Math.round(maxEleM),
    count: points.length,
  };
}

/** 按步长采样，控制最大点数。 */
function simplifyGpxPoints(points, maxPoints = 800) {
  if (!points || points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, i) => i % step === 0);
}

/** 读取本地 GPX 缓存。 */
function readGpxCache() {
  try {
    const raw = localStorage.getItem(GPX_CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch (e) {
    return {};
  }
}

/** 写入本地 GPX 缓存。 */
function writeGpxCache(cache) {
  try {
    localStorage.setItem(GPX_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    // 配额不足时静默失败
  }
}

/** 清空过期 GPX 缓存。 */
function cleanGpxCache() {
  const cache = readGpxCache();
  const now = Date.now();
  let changed = false;
  for (const url of Object.keys(cache)) {
    if (!cache[url] || !cache[url].ts || now - cache[url].ts > GPX_CACHE_MAX_AGE_MS) {
      delete cache[url];
      changed = true;
    }
  }
  if (changed) writeGpxCache(cache);
}

/** 解码内嵌的 data:application/gpx+xml;base64,... URL，返回 XML 文本。 */
function decodeGpxDataUrl(url) {
  if (!url || !url.startsWith('data:application/gpx+xml;base64,')) return null;
  const base64 = url.slice('data:application/gpx+xml;base64,'.length);
  try {
    return decodeURIComponent(escape(atob(base64)));
  } catch (e) {
    return null;
  }
}

/** 获取 GPX 文本，带本地缓存与离线回退。
 *  返回 { ok, text, fromCache, error }。
 */
async function fetchGpxWithCache(url) {
  cleanGpxCache();

  // 内嵌 base64 data URL 直接解码，不走网络/缓存
  if (url && url.startsWith('data:')) {
    const text = decodeGpxDataUrl(url);
    if (text == null) {
      return { ok: false, text: null, fromCache: false, error: '无法解析内嵌 GPX 数据' };
    }
    return { ok: true, text, fromCache: false, error: null };
  }

  const cache = readGpxCache();
  const cached = cache[url];
  if (cached && cached.text) {
    return { ok: true, text: cached.text, fromCache: true, error: null };
  }

  try {
    const res = await fetch(url, { method: 'GET', mode: 'cors' });
    if (!res.ok) {
      return { ok: false, text: null, fromCache: false, error: `HTTP ${res.status}` };
    }
    const text = await res.text();
    cache[url] = { text, ts: Date.now() };
    writeGpxCache(cache);
    return { ok: true, text, fromCache: false, error: null };
  } catch (err) {
    return { ok: false, text: null, fromCache: false, error: err && err.message ? err.message : String(err) };
  }
}

/** 清空所有 GPX 缓存（调试用）。 */
function clearGpxCache() {
  localStorage.removeItem(GPX_CACHE_KEY);
}
