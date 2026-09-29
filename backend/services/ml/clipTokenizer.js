/**
 * CLIP's text tokenizer: byte-level BPE with a 49,408-token vocabulary and a
 * 77-token context, reimplemented from the model repository's own files
 * (vocab.json and merges.txt) so that no tokenizer package is needed.
 *
 * It follows the tokenizer.json shipped with the model, step for step:
 *   1. normalise: Unicode NFC, every run of whitespace to one space, lowercase;
 *   2. split into pieces with CLIP's pattern: English contractions, runs of
 *      letters, single digits, runs of other symbols; whitespace is dropped;
 *   3. write each piece's UTF-8 bytes as printable characters (GPT-2's
 *      byte-to-unicode table), so any text maps onto the vocabulary;
 *   4. apply the BPE merges in rank order, with "</w>" marking the end of a
 *      piece;
 *   5. wrap in <|startoftext|> ... <|endoftext|>, truncated to 77 tokens.
 *
 * The OpenAI reference (simple_tokenizer.py) additionally runs ftfy and HTML
 * unescaping, which the Hugging Face tokenizer the ONNX export was traced with
 * does not; this file matches the latter. Special-token strings typed by a
 * user ("<|endoftext|>") are deliberately not honoured: they are ordinary
 * symbols here, so a query cannot end itself early.
 */

const fs = require("fs");

const CONTEXT_LENGTH = 77;
const START_TOKEN = "<|startoftext|>";
const END_TOKEN = "<|endoftext|>";
const END_OF_WORD = "</w>";

// CLIP's pre-tokenizer pattern without its two special-token alternatives.
// \p{White_Space} rather than \s: JavaScript's \s includes U+FEFF and omits
// U+0085, while the Rust tokenizer's \s is the Unicode White_Space property.
const PIECE = /'s|'t|'re|'ve|'m|'ll|'d|\p{L}+|\p{N}|[^\p{White_Space}\p{L}\p{N}]+/gu;
const WHITESPACE = /\p{White_Space}+/gu;

// Distinct pieces seen by one process are few (queries are short, words
// repeat); the cache keeps BPE off the hot path without growing unbounded.
const MAX_CACHED_PIECES = 10000;

/**
 * GPT-2's reversible byte-to-character table: printable Latin-1 bytes map to
 * themselves, the rest to U+0100 onward, so no byte becomes whitespace or a
 * control character that the BPE vocabulary could not contain.
 * @returns {string[]} 256 single-character strings, indexed by byte
 */
function bytesToUnicode() {
    const table = new Array(256);
    const printable = (b) => (b >= 0x21 && b <= 0x7e) || (b >= 0xa1 && b <= 0xac) || (b >= 0xae && b <= 0xff);
    let next = 256;
    for (let b = 0; b < 256; b += 1) table[b] = String.fromCodePoint(printable(b) ? b : next++);
    return table;
}

const BYTE_CHARS = bytesToUnicode();

/** Parses merges.txt: one "left right" pair per line after a "#version" header. */
function parseMerges(text) {
    const merges = [];
    for (const line of text.split(/\r?\n/)) {
        if (!line || line.startsWith("#version")) continue;
        const space = line.indexOf(" ");
        if (space <= 0) throw new Error(`Unreadable BPE merge: "${line}".`);
        merges.push([line.slice(0, space), line.slice(space + 1)]);
    }
    return merges;
}

/**
 * Builds a tokenizer from a vocabulary and merge list.
 * @param {{ vocab: Object<string, number>, merges: [string, string][] }} files
 */
function createClipTokenizer({ vocab, merges }) {
    const ids = new Map(Object.entries(vocab));
    // Pairs are keyed by their two symbols joined with a space; neither symbol
    // can contain one, since spaces are byte-encoded before BPE.
    const ranks = new Map(merges.map(([left, right], rank) => [`${left} ${right}`, rank]));
    const startId = ids.get(START_TOKEN);
    const endId = ids.get(END_TOKEN);
    if (startId === undefined || endId === undefined) throw new Error("The CLIP vocabulary has no start or end token.");
    const cache = new Map();

    /** BPE for one byte-encoded piece, as the reference implementation does it. */
    function bpe(piece) {
        const cached = cache.get(piece);
        if (cached) return cached;
        const chars = [...piece];
        let word = chars.slice(0, -1).concat(chars[chars.length - 1] + END_OF_WORD);
        while (word.length > 1) {
            // The adjacent pair learned earliest is merged first, everywhere it
            // occurs, left to right without overlaps.
            let best = null;
            let bestRank = Infinity;
            for (let i = 0; i < word.length - 1; i += 1) {
                const rank = ranks.get(`${word[i]} ${word[i + 1]}`);
                if (rank !== undefined && rank < bestRank) { bestRank = rank; best = [word[i], word[i + 1]]; }
            }
            if (!best) break;
            const merged = [];
            for (let i = 0; i < word.length; i += 1) {
                if (i < word.length - 1 && word[i] === best[0] && word[i + 1] === best[1]) {
                    merged.push(best[0] + best[1]);
                    i += 1;
                } else {
                    merged.push(word[i]);
                }
            }
            word = merged;
        }
        if (cache.size >= MAX_CACHED_PIECES) cache.clear();
        cache.set(piece, word);
        return word;
    }

    function byteEncode(piece) {
        let out = "";
        for (const byte of Buffer.from(piece, "utf8")) out += BYTE_CHARS[byte];
        return out;
    }

    function normalize(text) {
        return String(text).normalize("NFC").replace(WHITESPACE, " ").toLowerCase();
    }

    /**
     * The BPE tokens of `text`, without start and end markers.
     * @param {string} text
     * @param {number} [maxTokens] - stop once this many tokens are produced
     * @returns {string[]}
     */
    function tokenize(text, maxTokens = Infinity) {
        const tokens = [];
        for (const [piece] of normalize(text).matchAll(PIECE)) {
            tokens.push(...bpe(byteEncode(piece)));
            if (tokens.length >= maxTokens) break;
        }
        return tokens.length > maxTokens ? tokens.slice(0, maxTokens) : tokens;
    }

    /**
     * Token ids for the text encoder: start token, text, end token, at most
     * CONTEXT_LENGTH in all. Longer text keeps its beginning, as CLIP's own
     * truncation does. Not padded: the encoder reads the end token's position,
     * and its causal attention never looks past it.
     * @param {string} text
     * @returns {number[]}
     */
    function encode(text) {
        const tokens = tokenize(text, CONTEXT_LENGTH - 2);
        const out = [startId];
        for (const token of tokens) {
            const id = ids.get(token);
            // Every byte and every merge result is in CLIP's vocabulary, so a
            // miss means the files do not belong together.
            if (id === undefined) throw new Error(`The CLIP vocabulary has no token "${token}".`);
            out.push(id);
        }
        out.push(endId);
        return out;
    }

    return { encode, tokenize, startId, endId, contextLength: CONTEXT_LENGTH };
}

/** Reads the tokenizer from vocab.json and merges.txt on disk. */
function loadClipTokenizer(vocabPath, mergesPath) {
    return createClipTokenizer({
        vocab: JSON.parse(fs.readFileSync(vocabPath, "utf8")),
        merges: parseMerges(fs.readFileSync(mergesPath, "utf8")),
    });
}

module.exports = { createClipTokenizer, loadClipTokenizer, parseMerges, bytesToUnicode, CONTEXT_LENGTH };
