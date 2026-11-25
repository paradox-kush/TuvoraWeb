// Xtream Codes panel: URL builders and response mapping. Pure.
// Same endpoints as the apps' XtreamClient: player_api.php (login, get_live_categories,
// get_live_streams, get_short_epg) and /live/{user}/{pass}/{id}.{ext}.
// The apps always use .ts (their players demux it). A browser plays HLS through hls.js, so it
// asks for .m3u8 whenever the panel's allowed_output_formats lists it.

export function normalizeXtreamBase(value = "") {
  let base = String(value || "").trim();
  if (!base) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) base = `http://${base}`;
  base = base.replace(/\/player_api\.php.*$/i, "");
  return base.replace(/\/+$/, "");
}

export function xtreamApiUrl(account = {}, action = "", params = {}) {
  const query = [
    `username=${encodeURIComponent(account.username || "")}`,
    `password=${encodeURIComponent(account.password || "")}`
  ];
  if (action) query.push(`action=${encodeURIComponent(action)}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  });
  return `${normalizeXtreamBase(account.baseUrl)}/player_api.php?${query.join("&")}`;
}

export function chooseLiveExtension(allowedFormats) {
  const list = Array.isArray(allowedFormats) ? allowedFormats.map((f) => String(f).toLowerCase()) : [];
  if (!list.length || list.includes("m3u8")) return "m3u8";
  return list.includes("ts") ? "ts" : list[0];
}

export function xtreamLiveUrl(account = {}, streamId, extension = "m3u8") {
  const user = encodeURIComponent(account.username || "");
  const pass = encodeURIComponent(account.password || "");
  return `${normalizeXtreamBase(account.baseUrl)}/live/${user}/${pass}/${streamId}.${extension}`;
}

const OTHER_GROUP = "Other";

export function mapXtreamLive(categories = [], streams = []) {
  const names = new Map();
  const groups = [];
  (Array.isArray(categories) ? categories : []).forEach((category) => {
    const id = String(category?.category_id ?? "");
    const name = String(category?.category_name || "").trim() || OTHER_GROUP;
    if (!id || names.has(id)) return;
    names.set(id, name);
    if (!groups.includes(name)) groups.push(name);
  });
  const channels = [];
  let usedOther = false;
  (Array.isArray(streams) ? streams : []).forEach((stream) => {
    const streamId = Number(stream?.stream_id);
    if (!Number.isInteger(streamId) || streamId < 0) return;
    let group = names.get(String(stream?.category_id ?? ""));
    if (!group) {
      group = OTHER_GROUP;
      usedOther = true;
    }
    channels.push({
      id: String(streamId),
      streamId,
      name: String(stream?.name || "").trim() || `Channel ${streamId}`,
      logo: String(stream?.stream_icon || ""),
      tvgId: String(stream?.epg_channel_id || "").trim(),
      group,
      number: Number(stream?.num) || 0,
      catchUp: Number(stream?.tv_archive) === 1,
      url: ""
    });
  });
  if (usedOther && !groups.includes(OTHER_GROUP)) groups.push(OTHER_GROUP);
  return { groups: groups.filter((g) => channels.some((ch) => ch.group === g)), channels };
}

function decodeBase64Utf8(value) {
  const text = String(value || "");
  if (!text) return "";
  try {
    const binary = globalThis.atob(text);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return text;
  }
}

export function parseShortEpg(payload) {
  const rows = Array.isArray(payload?.epg_listings) ? payload.epg_listings : [];
  return rows
    .map((row) => ({
      title: decodeBase64Utf8(row?.title).trim(),
      description: decodeBase64Utf8(row?.description).trim(),
      startMs: Number(row?.start_timestamp) * 1000,
      endMs: Number(row?.stop_timestamp) * 1000
    }))
    .filter((p) => Number.isFinite(p.startMs) && Number.isFinite(p.endMs) && p.endMs > p.startMs)
    .sort((a, b) => a.startMs - b.startMs);
}
