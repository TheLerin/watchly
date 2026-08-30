const LANGUAGE_ALIASES = {
    en: 'en', eng: 'en', english: 'en',
    ml: 'ml', mal: 'ml', malayalam: 'ml',
    hi: 'hi', hin: 'hi', hindi: 'hi',
    ta: 'ta', tam: 'ta', tamil: 'ta',
    te: 'te', tel: 'te', telugu: 'te',
    kn: 'kn', kan: 'kn', kannada: 'kn',
    bn: 'bn', ben: 'bn', bengali: 'bn',
    es: 'es', spa: 'es', spanish: 'es',
    fr: 'fr', fra: 'fr', fre: 'fr', french: 'fr',
    de: 'de', deu: 'de', ger: 'de', german: 'de',
    ja: 'ja', jpn: 'ja', japanese: 'ja',
    ko: 'ko', kor: 'ko', korean: 'ko',
    ar: 'ar', ara: 'ar', arabic: 'ar',
};

const FORMAT_LABELS = {
    vtt: 'WebVTT',
    srt: 'SRT',
    ass: 'ASS (basic)',
    ssa: 'SSA (basic)',
};

const normalizeNewlines = value => value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

export function normalizeLanguageCode(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/_/g, '-');
    if (!raw || raw === 'und' || raw === 'unknown') return '';
    const primary = raw.split('-')[0];
    return LANGUAGE_ALIASES[raw] || LANGUAGE_ALIASES[primary] || raw;
}

export function languageDisplayName(value, fallback = '') {
    const code = normalizeLanguageCode(value);
    if (!code) return fallback;
    try {
        const locale = typeof navigator !== 'undefined' ? navigator.language : 'en';
        const displayNames = new Intl.DisplayNames([locale || 'en'], { type: 'language' });
        return displayNames.of(code) || fallback || code.toUpperCase();
    } catch {
        try {
            const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
            return displayNames.of(code) || fallback || code.toUpperCase();
        } catch {
            return fallback || code.toUpperCase();
        }
    }
}

export function inferSubtitleLanguage(filename) {
    const stem = String(filename || '').replace(/\.[^.]+$/, '').toLowerCase();
    const tokens = stem.split(/[.\s_\-[\]()]+/).filter(Boolean);
    for (let index = tokens.length - 1; index >= 0; index -= 1) {
        const normalized = normalizeLanguageCode(tokens[index]);
        if (normalized && (LANGUAGE_ALIASES[tokens[index]] || tokens[index].length <= 3)) return normalized;
    }
    return '';
}

export function sanitizeCueText(value) {
    const placeholders = [];
    const withoutUnsafeBlocks = String(value || '')
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<\/?(?:script|style)\b[^>]*>/gi, '')
        .replace(/<(\/?)\s*(b|i|u)\s*>/gi, (_, closing, tag) => {
            const token = `\u0000${placeholders.length}\u0000`;
            placeholders.push(`<${closing ? '/' : ''}${tag.toLowerCase()}>`);
            return token;
        })
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    return placeholders.reduce((text, tag, index) => text.replace(`\u0000${index}\u0000`, tag), withoutUnsafeBlocks);
}

const formatCueTimestamp = seconds => {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const totalMilliseconds = Math.round(safeSeconds * 1000);
    const hours = Math.floor(totalMilliseconds / 3_600_000);
    const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
    const remainderSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
    const milliseconds = totalMilliseconds % 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainderSeconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
};

export function subtitleCuesToWebVtt(cues, { note = '' } = {}) {
    const rendered = (cues || []).flatMap((cue, index) => {
        const start = Number(cue?.start);
        const end = Number(cue?.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
        const text = sanitizeCueText(cue.text).trim();
        if (!text) return [];
        return [`${index + 1}\n${formatCueTimestamp(start)} --> ${formatCueTimestamp(end)}\n${text}`];
    });
    if (!rendered.length) throw new Error('No readable subtitle cues were found in this track.');
    return `WEBVTT\n\n${note ? `NOTE ${note}\n\n` : ''}${rendered.join('\n\n')}\n`;
}

function toVttTimestamp(value) {
    const match = String(value || '').trim().match(/^(\d{1,2}):([0-5]\d):([0-5]\d)(?:[,.](\d{1,3}))?$/);
    if (!match) return null;
    const milliseconds = (match[4] || '0').padEnd(3, '0').slice(0, 3);
    return `${match[1].padStart(2, '0')}:${match[2]}:${match[3]}.${milliseconds}`;
}

export function srtToWebVtt(source) {
    const blocks = normalizeNewlines(source).trim().split(/\n{2,}/);
    const cues = [];

    for (const block of blocks) {
        const lines = block.split('\n');
        if (/^\d+$/.test(lines[0]?.trim())) lines.shift();
        const timingIndex = lines.findIndex(line => line.includes('-->'));
        if (timingIndex < 0) continue;
        const timing = lines[timingIndex].match(/^\s*(\S+)\s*-->\s*(\S+)(.*)$/);
        if (!timing) continue;
        const start = toVttTimestamp(timing[1]);
        const end = toVttTimestamp(timing[2]);
        if (!start || !end) continue;
        const allowedSettings = (timing[3] || '')
            .trim()
            .split(/\s+/)
            .filter(setting => /^(?:line|position|size|align):/i.test(setting))
            .join(' ');
        const text = sanitizeCueText(lines.slice(timingIndex + 1).join('\n').trim());
        if (!text) continue;
        cues.push(`${start} --> ${end}${allowedSettings ? ` ${allowedSettings}` : ''}\n${text}`);
    }

    if (!cues.length) throw new Error('No readable subtitle cues were found in this SRT file.');
    return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

function assTimestampToVtt(value) {
    const match = String(value || '').trim().match(/^(\d+):([0-5]\d):([0-5]\d)[.:](\d{1,3})$/);
    if (!match) return null;
    const milliseconds = match[4].length === 2 ? `${match[4]}0` : match[4].padEnd(3, '0').slice(0, 3);
    return `${match[1].padStart(2, '0')}:${match[2]}:${match[3]}.${milliseconds}`;
}

function splitAssFields(value, count) {
    const fields = [];
    let remainder = value;
    for (let index = 0; index < count - 1; index += 1) {
        const comma = remainder.indexOf(',');
        if (comma < 0) return null;
        fields.push(remainder.slice(0, comma));
        remainder = remainder.slice(comma + 1);
    }
    fields.push(remainder);
    return fields;
}

export function assToWebVtt(source) {
    const lines = normalizeNewlines(source).split('\n');
    let inEvents = false;
    let format = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    const cues = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (/^\[events\]$/i.test(trimmed)) {
            inEvents = true;
            continue;
        }
        if (/^\[.+\]$/.test(trimmed)) {
            inEvents = false;
            continue;
        }
        if (!inEvents) continue;
        const formatMatch = trimmed.match(/^format\s*:\s*(.+)$/i);
        if (formatMatch) {
            format = formatMatch[1].split(',').map(field => field.trim().toLowerCase());
            continue;
        }
        const dialogueMatch = trimmed.match(/^dialogue\s*:\s*(.+)$/i);
        if (!dialogueMatch) continue;
        const fields = splitAssFields(dialogueMatch[1], format.length);
        if (!fields) continue;
        const row = Object.fromEntries(format.map((field, index) => [field, fields[index]?.trim() || '']));
        const start = assTimestampToVtt(row.start);
        const end = assTimestampToVtt(row.end);
        if (!start || !end) continue;
        const text = sanitizeCueText((row.text || '')
            .replace(/\{[^}]*\}/g, '')
            .replace(/\\[Nn]/g, '\n')
            .replace(/\\h/g, ' ')
            .trim());
        if (text) cues.push(`${start} --> ${end}\n${text}`);
    }

    if (!cues.length) throw new Error('No readable dialogue cues were found in this ASS/SSA file.');
    return `WEBVTT\n\nNOTE Converted from ASS/SSA. Advanced styling, positioning, karaoke, and animation are not preserved.\n\n${cues.join('\n\n')}\n`;
}

export async function parseSubtitleFile(file) {
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    if (!['vtt', 'srt', 'ass', 'ssa'].includes(extension)) {
        throw new Error('Choose a WebVTT, SRT, ASS, or SSA subtitle file.');
    }
    const source = await file.text();
    let vtt = normalizeNewlines(source);
    let limited = false;
    if (extension === 'srt') vtt = srtToWebVtt(source);
    if (extension === 'ass' || extension === 'ssa') {
        vtt = assToWebVtt(source);
        limited = true;
    }
    if (extension === 'vtt' && !/^WEBVTT(?:\s|$)/.test(vtt.trimStart())) {
        throw new Error('This file is not valid WebVTT.');
    }

    const language = inferSubtitleLanguage(file.name);
    const stem = file.name.replace(/\.[^.]+$/, '').replace(/[._-]+/g, ' ').trim();
    const languageLabel = languageDisplayName(language);
    return {
        blob: new Blob([vtt], { type: 'text/vtt;charset=utf-8' }),
        format: extension,
        formatLabel: FORMAT_LABELS[extension],
        language,
        label: languageLabel || stem || 'External subtitles',
        limited,
    };
}
