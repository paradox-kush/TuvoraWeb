// M3U / M3U8 playlist text -> live channels. Pure. Mirrors the apps' M3UParser essentials:
// header url-tvg / x-tvg-url, #EXTINF attributes (tvg-id, tvg-name, tvg-logo, group-title),
// #EXTGRP fallback, name after the first unquoted comma, bare urls without #EXTINF skipped.
// #EXTVLCOPT / http-user-agent / http-referrer mark a channel that needs headers a page cannot send.

const ATTR = /([a-zA-Z0-9_-]+)="([^"]*)"/g;

function attributes(text) {
  const out = {};
  for (const match of text.matchAll(ATTR)) out[match[1].toLowerCase()] = match[2];
  return out;
}

/** Index of the first comma outside double quotes, or -1. */
function nameComma(line) {
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === "," && !quoted) return i;
  }
  return -1;
}

function hashString(value) {
  // FNV-1a 32-bit: stable and cheap, only used to tell channels in one list apart.
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export function parseM3u(text = "") {
  const source = String(text || "").replace(/^﻿/, "");
  const lines = source.split(/\r?\n/);
  const firstContent = lines.find((line) => line.trim()) || "";
  const valid = !source.trim() || /^#EXT/i.test(firstContent.trim());
  const result = { valid, tvgUrl: "", channels: [] };
  if (!valid) return result;

  let pending = null;
  const seen = new Map();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#EXTM3U/i.test(line)) {
      const attrs = attributes(line);
      result.tvgUrl = attrs["url-tvg"] || attrs["x-tvg-url"] || result.tvgUrl;
      continue;
    }
    if (/^#EXTINF/i.test(line)) {
      const comma = nameComma(line);
      const head = comma >= 0 ? line.slice(0, comma) : line;
      const attrs = attributes(head);
      const name = (comma >= 0 ? line.slice(comma + 1) : "").trim() || attrs["tvg-name"] || "";
      pending = {
        name,
        tvgId: (attrs["tvg-id"] || "").trim(),
        logo: attrs["tvg-logo"] || "",
        group: attrs["group-title"] || "",
        needsHeaders: Boolean(attrs["http-user-agent"] || attrs["http-referrer"])
      };
      continue;
    }
    if (/^#EXTGRP:/i.test(line)) {
      if (pending && !pending.group) pending.group = line.slice(8).trim();
      continue;
    }
    if (/^#EXTVLCOPT:/i.test(line) || /^#KODIPROP:/i.test(line)) {
      if (pending && /http-(user-agent|referrer)|inputstream/i.test(line)) pending.needsHeaders = true;
      continue;
    }
    if (line.startsWith("#")) continue;
    if (!pending) continue;
    const base = hashString(`${pending.tvgId}|${pending.name}|${line}`);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    result.channels.push({
      id: count ? `${base}-${count}` : base,
      name: pending.name || line,
      tvgId: pending.tvgId,
      logo: pending.logo,
      group: pending.group,
      url: line,
      needsHeaders: pending.needsHeaders,
      catchUp: false
    });
    pending = null;
  }
  return result;
}
