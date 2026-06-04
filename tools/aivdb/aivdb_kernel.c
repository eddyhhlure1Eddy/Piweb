#ifndef _WIN32
#define _FILE_OFFSET_BITS 64
#define _POSIX_C_SOURCE 200809L
#endif

#include "aivdb_kernel.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <math.h>

#ifdef _WIN32
#include <windows.h>
#include <io.h>
#else
#include <sys/types.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#endif

#if !defined(AIVDB_FORCE_SCALAR) && defined(__SSE__)
#include <xmmintrin.h>
#endif
#if !defined(AIVDB_FORCE_SCALAR) && defined(__AVX__)
#include <immintrin.h>
#endif
#if !defined(AIVDB_FORCE_SCALAR) && (defined(__ARM_NEON) || defined(__ARM_NEON__))
#include <arm_neon.h>
#endif

#define AIVDB_POSTING_MAX 65536
#define AIVDB_TOKEN_MAX 2048
#define AIVDB_HASH_SIZE 8192
#define AIVDB_MAX_CHUNKS 1048576

#if defined(__GNUC__) || defined(__clang__)
#define AIVDB_MAYBE_UNUSED __attribute__((unused))
#else
#define AIVDB_MAYBE_UNUSED
#endif

typedef struct {
    uint32_t token_hash;
    uint32_t df;
    uint32_t posting_cap;
    uint32_t posting_len;
    uint32_t *posting_ids;
    float *posting_scores;
} aivdb_posting_t;

typedef struct {
    uint32_t n_postings;
    uint32_t cap;
    aivdb_posting_t *postings;
    uint32_t hash_cap;
    int32_t *hash_slots;
} aivdb_inverted_t;

struct aivdb_t {
    aivdb_header_t header;
    float *vectors;
    aivdb_chunk_t *chunks;
    char *text_blob;
    char *metadata_blob;
    aivdb_inverted_t inverted;
    char *doc_paths[4096];
    char *doc_titles[4096];
    uint32_t chunk_cap;
    uint64_t text_cap;
    uint64_t metadata_cap;
    int writable;
    int own_vectors;
    int own_chunks;
    int own_text;
    int own_metadata;
};

static char *aivdb_strdup(const char *s) {
    if (!s) return NULL;
    size_t n = strlen(s) + 1;
    char *out = (char *)malloc(n);
    if (out) memcpy(out, s, n);
    return out;
}

static int aivdb_fseek64(FILE *f, uint64_t offset) {
#ifdef _WIN32
    return _fseeki64(f, (__int64)offset, SEEK_SET);
#else
    return fseeko(f, (off_t)offset, SEEK_SET);
#endif
}

static int aivdb_sync_file(FILE *f) {
    if (!f) return -1;
    if (fflush(f) != 0) return -1;
#ifdef _WIN32
    return _commit(_fileno(f));
#else
    return fsync(fileno(f));
#endif
}

static char *aivdb_make_tmp_path(const char *path, const void *salt) {
    if (!path) return NULL;
    size_t n = strlen(path) + 80;
    char *tmp = (char *)malloc(n);
    if (!tmp) return NULL;
#ifdef _WIN32
    unsigned long pid = (unsigned long)GetCurrentProcessId();
#else
    unsigned long pid = (unsigned long)getpid();
#endif
    int written = snprintf(tmp, n, "%s.tmp.%lu.%p", path, pid, salt);
    if (written < 0 || (size_t)written >= n) {
        free(tmp);
        return NULL;
    }
    return tmp;
}

static int aivdb_replace_file(const char *tmp_path, const char *path) {
#ifdef _WIN32
    return MoveFileExA(tmp_path, path, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) ? 0 : -1;
#else
    return rename(tmp_path, path);
#endif
}

static uint32_t fnv1a(const char *s, uint32_t len) {
    uint32_t h = 2166136261u;
    for (uint32_t i = 0; i < len; i++) {
        h ^= (uint8_t)s[i];
        h *= 16777619u;
    }
    return h;
}

static int is_cjk(uint32_t c) {
    return (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF) ||
           (c >= 0x20000 && c <= 0x2A6DF);
}

static uint32_t next_utf8(const char *s, uint32_t pos, uint32_t len, uint32_t *cp) {
    if (pos >= len) { *cp = 0; return len; }
    uint8_t b = (uint8_t)s[pos];
    if (b < 0x80) { *cp = b; return pos + 1; }
    if ((b & 0xE0) == 0xC0 && pos + 1 < len) { *cp = ((b & 0x1F) << 6) | (s[pos+1] & 0x3F); return pos + 2; }
    if ((b & 0xF0) == 0xE0 && pos + 2 < len) { *cp = ((b & 0x0F) << 12) | ((s[pos+1] & 0x3F) << 6) | (s[pos+2] & 0x3F); return pos + 3; }
    if ((b & 0xF8) == 0xF0 && pos + 3 < len) { *cp = ((b & 0x07) << 18) | ((s[pos+1] & 0x3F) << 12) | ((s[pos+2] & 0x3F) << 6) | (s[pos+3] & 0x3F); return pos + 4; }
    *cp = b; return pos + 1;
}

static int is_sep(uint32_t cp) {
    return cp == 0 || cp == ' ' || cp == '\t' || cp == '\n' || cp == '\r' ||
           cp == ',' || cp == '.' || cp == ';' || cp == ':' || cp == '!' ||
           cp == '?' || cp == '(' || cp == ')' || cp == '[' || cp == ']' ||
           cp == '{' || cp == '}' || cp == '<' || cp == '>' || cp == '"' ||
           cp == '\'' || cp == '|' || cp == '&' || cp == '*' || cp == '+' ||
           cp == '=' || cp == '/' || cp == '\\' || cp == '~' || cp == '`' ||
           cp == 0x3001 || cp == 0x3002 || cp == 0xFF0C || cp == 0xFF01 ||
           cp == 0xFF1F || cp == 0x300A || cp == 0x300B || cp == 0x3010 ||
           cp == 0x3011 || cp == 0x2014 || cp == 0x2026;
}

static uint32_t utf8_encode(uint32_t cp, char *buf) {
    if (cp < 0x80) {
        buf[0] = (char)cp;
        return 1;
    }
    if (cp < 0x800) {
        buf[0] = (char)(0xC0 | (cp >> 6));
        buf[1] = (char)(0x80 | (cp & 0x3F));
        return 2;
    }
    if (cp < 0x10000) {
        buf[0] = (char)(0xE0 | (cp >> 12));
        buf[1] = (char)(0x80 | ((cp >> 6) & 0x3F));
        buf[2] = (char)(0x80 | (cp & 0x3F));
        return 3;
    }
    buf[0] = (char)(0xF0 | (cp >> 18));
    buf[1] = (char)(0x80 | ((cp >> 12) & 0x3F));
    buf[2] = (char)(0x80 | ((cp >> 6) & 0x3F));
    buf[3] = (char)(0x80 | (cp & 0x3F));
    return 4;
}

static void token_push(uint32_t *tokens, uint32_t *ntokens, const char *buf, uint32_t len) {
    if (len == 0 || *ntokens >= AIVDB_TOKEN_MAX) return;
    tokens[(*ntokens)++] = fnv1a(buf, len);
}

static void flush_word(uint32_t *tokens, uint32_t *ntokens, char *word, uint32_t *word_len) {
    if (*word_len > 0) {
        token_push(tokens, ntokens, word, *word_len);
        *word_len = 0;
    }
}

static void tokenize_text(const char *text, uint32_t len, uint32_t *tokens, uint32_t *ntokens) {
    *ntokens = 0;
    uint32_t pos = 0, cp = 0;
    char word[256];
    uint32_t word_len = 0;
    char prev_cjk[8];
    uint32_t prev_cjk_len = 0;

    while (pos < len && *ntokens < AIVDB_TOKEN_MAX) {
        pos = next_utf8(text, pos, len, &cp);
        if (cp == 0 || is_sep(cp)) {
            flush_word(tokens, ntokens, word, &word_len);
            prev_cjk_len = 0;
            continue;
        }

        if (is_cjk(cp)) {
            flush_word(tokens, ntokens, word, &word_len);
            char cur[8];
            uint32_t cur_len = utf8_encode(cp, cur);
            token_push(tokens, ntokens, cur, cur_len);
            if (prev_cjk_len > 0 && *ntokens < AIVDB_TOKEN_MAX) {
                char bigram[16];
                memcpy(bigram, prev_cjk, prev_cjk_len);
                memcpy(bigram + prev_cjk_len, cur, cur_len);
                token_push(tokens, ntokens, bigram, prev_cjk_len + cur_len);
            }
            memcpy(prev_cjk, cur, cur_len);
            prev_cjk_len = cur_len;
            continue;
        }

        prev_cjk_len = 0;
        char encoded[8];
        uint32_t encoded_len = utf8_encode(cp, encoded);
        for (uint32_t i = 0; i < encoded_len && word_len + 1 < sizeof(word); i++) {
            char ch = encoded[i];
            if (ch >= 'A' && ch <= 'Z') ch = (char)(ch + ('a' - 'A'));
            word[word_len++] = ch;
        }
    }

    flush_word(tokens, ntokens, word, &word_len);
}

static int cmp_u32(const void *a, const void *b) {
    uint32_t x = *(const uint32_t *)a;
    uint32_t y = *(const uint32_t *)b;
    return (x > y) - (x < y);
}

static uint32_t dedupe_tokens(uint32_t *tokens, uint32_t ntokens) {
    if (ntokens <= 1) return ntokens;
    qsort(tokens, ntokens, sizeof(uint32_t), cmp_u32);
    uint32_t out = 1;
    for (uint32_t i = 1; i < ntokens; i++) {
        if (tokens[i] != tokens[out - 1]) tokens[out++] = tokens[i];
    }
    return out;
}

static void inverted_init(aivdb_inverted_t *inv) {
    inv->n_postings = 0;
    inv->cap = 256;
    inv->postings = (aivdb_posting_t *)calloc(inv->cap, sizeof(aivdb_posting_t));
    inv->hash_cap = AIVDB_HASH_SIZE;
    inv->hash_slots = (int32_t *)malloc(inv->hash_cap * sizeof(int32_t));
    if (inv->hash_slots) {
        for (uint32_t i = 0; i < inv->hash_cap; i++) inv->hash_slots[i] = -1;
    }
}

static void inverted_free(aivdb_inverted_t *inv) {
    for (uint32_t i = 0; i < inv->n_postings; i++) {
        free(inv->postings[i].posting_ids);
        free(inv->postings[i].posting_scores);
    }
    free(inv->postings);
    free(inv->hash_slots);
    inv->postings = NULL;
    inv->hash_slots = NULL;
    inv->n_postings = 0;
    inv->cap = 0;
    inv->hash_cap = 0;
}

static int inverted_rehash(aivdb_inverted_t *inv, uint32_t new_cap) {
    int32_t *slots = (int32_t *)malloc(new_cap * sizeof(int32_t));
    if (!slots) return -1;
    for (uint32_t i = 0; i < new_cap; i++) slots[i] = -1;

    for (uint32_t i = 0; i < inv->n_postings; i++) {
        uint32_t h = inv->postings[i].token_hash;
        uint32_t slot = h & (new_cap - 1);
        while (slots[slot] >= 0) slot = (slot + 1) & (new_cap - 1);
        slots[slot] = (int32_t)i;
    }
    free(inv->hash_slots);
    inv->hash_slots = slots;
    inv->hash_cap = new_cap;
    return 0;
}

static aivdb_posting_t *inverted_find(aivdb_inverted_t *inv, uint32_t token_hash) {
    if (!inv || !inv->hash_slots || inv->hash_cap == 0) return NULL;
    uint32_t slot = token_hash & (inv->hash_cap - 1);
    for (uint32_t probe = 0; probe < inv->hash_cap; probe++) {
        int32_t idx = inv->hash_slots[slot];
        if (idx < 0) return NULL;
        if (inv->postings[idx].token_hash == token_hash) return &inv->postings[idx];
        slot = (slot + 1) & (inv->hash_cap - 1);
    }
    return NULL;
}

static aivdb_posting_t *inverted_find_or_create(aivdb_inverted_t *inv, uint32_t token_hash) {
    aivdb_posting_t *found = inverted_find(inv, token_hash);
    if (found) return found;

    if (!inv->hash_slots || inv->hash_cap == 0) {
        inv->hash_cap = AIVDB_HASH_SIZE;
        inv->hash_slots = (int32_t *)malloc(inv->hash_cap * sizeof(int32_t));
        if (!inv->hash_slots) return NULL;
        for (uint32_t i = 0; i < inv->hash_cap; i++) inv->hash_slots[i] = -1;
    }
    if ((inv->n_postings + 1) * 10 >= inv->hash_cap * 7) {
        if (inverted_rehash(inv, inv->hash_cap * 2) != 0) return NULL;
    }

    if (inv->n_postings >= inv->cap) {
        inv->cap *= 2;
        inv->postings = (aivdb_posting_t *)realloc(inv->postings, inv->cap * sizeof(aivdb_posting_t));
        if (!inv->postings) return NULL;
        memset(inv->postings + inv->n_postings, 0, (inv->cap - inv->n_postings) * sizeof(aivdb_posting_t));
    }
    aivdb_posting_t *p = &inv->postings[inv->n_postings++];
    p->token_hash = token_hash;
    p->df = 0;
    p->posting_cap = 64;
    p->posting_len = 0;
    p->posting_ids = (uint32_t *)malloc(p->posting_cap * sizeof(uint32_t));
    p->posting_scores = (float *)malloc(p->posting_cap * sizeof(float));

    uint32_t slot = token_hash & (inv->hash_cap - 1);
    while (inv->hash_slots[slot] >= 0) slot = (slot + 1) & (inv->hash_cap - 1);
    inv->hash_slots[slot] = (int32_t)(inv->n_postings - 1);
    return p;
}

static void inverted_add(aivdb_inverted_t *inv, uint32_t token_hash, uint32_t chunk_id, float score) {
    aivdb_posting_t *p = inverted_find_or_create(inv, token_hash);
    if (!p) return;
    if (p->posting_len >= p->posting_cap) {
        p->posting_cap *= 2;
        p->posting_ids = (uint32_t *)realloc(p->posting_ids, p->posting_cap * sizeof(uint32_t));
        p->posting_scores = (float *)realloc(p->posting_scores, p->posting_cap * sizeof(float));
        if (!p->posting_ids || !p->posting_scores) return;
    }
    p->posting_ids[p->posting_len] = chunk_id;
    p->posting_scores[p->posting_len] = score;
    p->posting_len++;
    p->df++;
}

static AIVDB_MAYBE_UNUSED float dot_f32_scalar(const float *a, const float *b, uint32_t dim) {
    float s = 0.0f;
    uint32_t i = 0;
    float s0 = 0.0f, s1 = 0.0f, s2 = 0.0f, s3 = 0.0f;
    for (; i + 4 <= dim; i += 4) {
        s0 += a[i] * b[i];
        s1 += a[i + 1] * b[i + 1];
        s2 += a[i + 2] * b[i + 2];
        s3 += a[i + 3] * b[i + 3];
    }
    s = s0 + s1 + s2 + s3;
    for (; i < dim; i++) s += a[i] * b[i];
    return s;
}

#if !defined(AIVDB_FORCE_SCALAR) && defined(__AVX__)
static AIVDB_MAYBE_UNUSED float dot_f32_avx(const float *a, const float *b, uint32_t dim) {
    __m256 sum0 = _mm256_setzero_ps();
    __m256 sum1 = _mm256_setzero_ps();
    __m256 sum2 = _mm256_setzero_ps();
    __m256 sum3 = _mm256_setzero_ps();
    uint32_t i = 0;
    for (; i + 32 <= dim; i += 32) {
        sum0 = _mm256_add_ps(sum0, _mm256_mul_ps(_mm256_loadu_ps(a + i), _mm256_loadu_ps(b + i)));
        sum1 = _mm256_add_ps(sum1, _mm256_mul_ps(_mm256_loadu_ps(a + i + 8), _mm256_loadu_ps(b + i + 8)));
        sum2 = _mm256_add_ps(sum2, _mm256_mul_ps(_mm256_loadu_ps(a + i + 16), _mm256_loadu_ps(b + i + 16)));
        sum3 = _mm256_add_ps(sum3, _mm256_mul_ps(_mm256_loadu_ps(a + i + 24), _mm256_loadu_ps(b + i + 24)));
    }
    sum0 = _mm256_add_ps(_mm256_add_ps(sum0, sum1), _mm256_add_ps(sum2, sum3));
    for (; i + 8 <= dim; i += 8) {
        sum0 = _mm256_add_ps(sum0, _mm256_mul_ps(_mm256_loadu_ps(a + i), _mm256_loadu_ps(b + i)));
    }
    float result[8];
    _mm256_storeu_ps(result, sum0);
    float s = result[0] + result[1] + result[2] + result[3] + result[4] + result[5] + result[6] + result[7];
    for (; i < dim; i++) s += a[i] * b[i];
    return s;
}
#endif

#if !defined(AIVDB_FORCE_SCALAR) && defined(__SSE__)
static AIVDB_MAYBE_UNUSED float dot_f32_sse(const float *a, const float *b, uint32_t dim) {
    __m128 sum0 = _mm_setzero_ps();
    __m128 sum1 = _mm_setzero_ps();
    __m128 sum2 = _mm_setzero_ps();
    __m128 sum3 = _mm_setzero_ps();
    uint32_t i = 0;
    for (; i + 16 <= dim; i += 16) {
        sum0 = _mm_add_ps(sum0, _mm_mul_ps(_mm_loadu_ps(a + i), _mm_loadu_ps(b + i)));
        sum1 = _mm_add_ps(sum1, _mm_mul_ps(_mm_loadu_ps(a + i + 4), _mm_loadu_ps(b + i + 4)));
        sum2 = _mm_add_ps(sum2, _mm_mul_ps(_mm_loadu_ps(a + i + 8), _mm_loadu_ps(b + i + 8)));
        sum3 = _mm_add_ps(sum3, _mm_mul_ps(_mm_loadu_ps(a + i + 12), _mm_loadu_ps(b + i + 12)));
    }
    sum0 = _mm_add_ps(_mm_add_ps(sum0, sum1), _mm_add_ps(sum2, sum3));
    for (; i + 4 <= dim; i += 4) {
        sum0 = _mm_add_ps(sum0, _mm_mul_ps(_mm_loadu_ps(a + i), _mm_loadu_ps(b + i)));
    }
    float result[4];
    _mm_storeu_ps(result, sum0);
    float s = result[0] + result[1] + result[2] + result[3];
    for (; i < dim; i++) s += a[i] * b[i];
    return s;
}
#endif

#if !defined(AIVDB_FORCE_SCALAR) && (defined(__ARM_NEON) || defined(__ARM_NEON__))
static AIVDB_MAYBE_UNUSED float dot_f32_neon(const float *a, const float *b, uint32_t dim) {
    float32x4_t sum0 = vdupq_n_f32(0.0f);
    float32x4_t sum1 = vdupq_n_f32(0.0f);
    float32x4_t sum2 = vdupq_n_f32(0.0f);
    float32x4_t sum3 = vdupq_n_f32(0.0f);
    uint32_t i = 0;
    for (; i + 16 <= dim; i += 16) {
        sum0 = vmlaq_f32(sum0, vld1q_f32(a + i), vld1q_f32(b + i));
        sum1 = vmlaq_f32(sum1, vld1q_f32(a + i + 4), vld1q_f32(b + i + 4));
        sum2 = vmlaq_f32(sum2, vld1q_f32(a + i + 8), vld1q_f32(b + i + 8));
        sum3 = vmlaq_f32(sum3, vld1q_f32(a + i + 12), vld1q_f32(b + i + 12));
    }
    sum0 = vaddq_f32(vaddq_f32(sum0, sum1), vaddq_f32(sum2, sum3));
    for (; i + 4 <= dim; i += 4) {
        sum0 = vmlaq_f32(sum0, vld1q_f32(a + i), vld1q_f32(b + i));
    }
#if defined(__aarch64__)
    float s = vaddvq_f32(sum0);
#else
    float32x2_t pair = vadd_f32(vget_low_f32(sum0), vget_high_f32(sum0));
    pair = vpadd_f32(pair, pair);
    float s = vget_lane_f32(pair, 0);
#endif
    for (; i < dim; i++) s += a[i] * b[i];
    return s;
}
#endif

static float dot_f32(const float *a, const float *b, uint32_t dim) {
#if !defined(AIVDB_FORCE_SCALAR) && (defined(__ARM_NEON) || defined(__ARM_NEON__))
    return dot_f32_neon(a, b, dim);
#elif !defined(AIVDB_FORCE_SCALAR) && defined(__AVX__)
    return dot_f32_avx(a, b, dim);
#elif !defined(AIVDB_FORCE_SCALAR) && defined(__SSE__)
    return dot_f32_sse(a, b, dim);
#else
    return dot_f32_scalar(a, b, dim);
#endif
}

static void topk_swap(aivdb_hit_t *a, aivdb_hit_t *b) {
    aivdb_hit_t tmp = *a;
    *a = *b;
    *b = tmp;
}

static void topk_sift_up(aivdb_hit_t *hits, uint32_t idx) {
    while (idx > 0) {
        uint32_t parent = (idx - 1) >> 1;
        if (hits[parent].score <= hits[idx].score) break;
        topk_swap(&hits[parent], &hits[idx]);
        idx = parent;
    }
}

static void topk_sift_down(aivdb_hit_t *hits, uint32_t n, uint32_t idx) {
    for (;;) {
        uint32_t left = idx * 2 + 1;
        uint32_t right = left + 1;
        uint32_t smallest = idx;
        if (left < n && hits[left].score < hits[smallest].score) smallest = left;
        if (right < n && hits[right].score < hits[smallest].score) smallest = right;
        if (smallest == idx) break;
        topk_swap(&hits[idx], &hits[smallest]);
        idx = smallest;
    }
}

static void topk_push(aivdb_hit_t *hits, uint32_t *k, uint32_t capacity, uint32_t chunk_id, float score) {
    if (capacity == 0) return;
    if (*k < capacity) {
        hits[*k].chunk_id = chunk_id;
        hits[*k].score = score;
        topk_sift_up(hits, *k);
        (*k)++;
        return;
    }
    if (score > hits[0].score) {
        hits[0].chunk_id = chunk_id;
        hits[0].score = score;
        topk_sift_down(hits, *k, 0);
    }
}

static void topk_sort(aivdb_hit_t *hits, uint32_t k) {
    for (uint32_t i = 1; i < k; i++) {
        aivdb_hit_t tmp = hits[i];
        int32_t j = (int32_t)i - 1;
        while (j >= 0 && hits[j].score < tmp.score) {
            hits[j + 1] = hits[j];
            j--;
        }
        hits[j + 1] = tmp;
    }
}

static uint32_t grow_u32_cap(uint32_t current, uint32_t needed) {
    uint32_t cap = current ? current : 64;
    while (cap < needed) {
        if (cap > AIVDB_MAX_CHUNKS / 2) return needed;
        cap *= 2;
    }
    return cap;
}

static uint64_t grow_u64_cap(uint64_t current, uint64_t needed) {
    uint64_t cap = current ? current : 4096;
    while (cap < needed) cap *= 2;
    return cap;
}

static int reserve_chunks(aivdb_t *db, uint32_t needed) {
    if (needed > AIVDB_MAX_CHUNKS) return -1;
    if (db->chunk_cap >= needed) return 0;
    uint32_t new_cap = grow_u32_cap(db->chunk_cap, needed);
    uint32_t dim = db->header.dim;
    aivdb_chunk_t *new_chunks = (aivdb_chunk_t *)realloc(db->chunks, (size_t)new_cap * sizeof(aivdb_chunk_t));
    if (!new_chunks) return -1;
    db->chunks = new_chunks;
    float *new_vectors = (float *)realloc(db->vectors, (size_t)new_cap * dim * sizeof(float));
    if (!new_vectors) return -1;
    db->vectors = new_vectors;
    db->chunk_cap = new_cap;
    db->own_vectors = 1;
    db->own_chunks = 1;
    return 0;
}

static int reserve_text(aivdb_t *db, uint64_t needed) {
    if (db->text_cap >= needed) return 0;
    uint64_t new_cap = grow_u64_cap(db->text_cap, needed);
    char *new_blob = (char *)realloc(db->text_blob, (size_t)new_cap);
    if (!new_blob) return -1;
    db->text_blob = new_blob;
    db->text_cap = new_cap;
    db->own_text = 1;
    return 0;
}

static int reserve_metadata(aivdb_t *db, uint64_t needed) {
    if (db->metadata_cap >= needed) return 0;
    char *new_blob = (char *)realloc(db->metadata_blob, (size_t)needed);
    if (!new_blob) return -1;
    db->metadata_blob = new_blob;
    db->metadata_cap = needed;
    db->own_metadata = 1;
    return 0;
}

int aivdb_create(const char *path, uint32_t dim) {
    if (dim == 0 || dim > AIVDB_DIM_MAX) return -1;
    FILE *f = fopen(path, "wb");
    if (!f) return -1;
    aivdb_header_t hdr;
    memset(&hdr, 0, sizeof(hdr));
    memcpy(hdr.magic, AIVDB_MAGIC, 8);
    hdr.version = AIVDB_VERSION;
    hdr.dim = dim;
    hdr.chunk_count = 0;
    hdr.doc_count = 0;
    hdr.token_count = 0;
    hdr.text_blob_offset = sizeof(aivdb_header_t);
    hdr.text_blob_size = 0;
    hdr.vector_block_offset = hdr.text_blob_offset;
    hdr.vector_block_size = 0;
    hdr.chunk_table_offset = hdr.vector_block_offset;
    hdr.chunk_table_size = 0;
    hdr.inverted_offset = 0;
    hdr.inverted_size = 0;
    hdr.metadata_offset = 0;
    hdr.metadata_size = 0;
    hdr.symbol_offset = 0;
    hdr.symbol_size = 0;
    fwrite(&hdr, sizeof(hdr), 1, f);
    fclose(f);
    return 0;
}

static void rebuild_inverted_from_chunks(aivdb_t *db) {
    if (!db || !db->chunks || !db->text_blob) return;
    inverted_free(&db->inverted);
    inverted_init(&db->inverted);
    for (uint32_t i = 0; i < db->header.chunk_count; i++) {
        aivdb_chunk_t *chunk = &db->chunks[i];
        if (chunk->text_offset >= db->header.text_blob_size) continue;
        const char *text = db->text_blob + chunk->text_offset;
        uint32_t text_len = chunk->text_len;
        uint32_t tokens[AIVDB_TOKEN_MAX];
        uint32_t ntokens;
        tokenize_text(text, text_len, tokens, &ntokens);
        ntokens = dedupe_tokens(tokens, ntokens);
        float tf_norm = (chunk->token_count > 0) ? 1.0f / (1.0f + sqrtf((float)chunk->token_count)) : 1.0f;
        for (uint32_t t = 0; t < ntokens; t++) inverted_add(&db->inverted, tokens[t], i, tf_norm);
    }
}

int aivdb_open(const char *path, aivdb_t **db) {
    FILE *f = fopen(path, "rb");
    if (!f) return -1;
    aivdb_header_t hdr;
    if (fread(&hdr, sizeof(hdr), 1, f) != 1) { fclose(f); return -1; }
    if (memcmp(hdr.magic, AIVDB_MAGIC, 8) != 0) { fclose(f); return -1; }
    fclose(f);

    aivdb_t *d = (aivdb_t *)calloc(1, sizeof(aivdb_t));
    d->header = hdr;
    d->vectors = NULL;
    d->chunks = NULL;
    d->text_blob = NULL;
    d->metadata_blob = NULL;
    d->own_vectors = 0;
    d->own_chunks = 0;
    d->own_text = 0;
    d->own_metadata = 0;
    d->chunk_cap = 0;
    d->text_cap = 0;
    d->metadata_cap = 0;
    d->writable = 0;
    inverted_init(&d->inverted);

    if (hdr.chunk_count > 0) {
        uint32_t dim = hdr.dim;
        uint32_t n = hdr.chunk_count;
        if (hdr.chunk_table_offset > 0 && hdr.chunk_table_size >= (uint64_t)n * sizeof(aivdb_chunk_t)) {
            d->chunks = (aivdb_chunk_t *)malloc((size_t)n * sizeof(aivdb_chunk_t));
            if (!d->chunks) { aivdb_close(d); return -1; }
            f = fopen(path, "rb");
            if (!f) { aivdb_close(d); return -1; }
            if (aivdb_fseek64(f, hdr.chunk_table_offset) != 0 ||
                fread(d->chunks, sizeof(aivdb_chunk_t), n, f) != n) {
                fclose(f); aivdb_close(d); return -1;
            }
            fclose(f);
            d->own_chunks = 1;
            d->chunk_cap = n;
        }

        if (hdr.vector_block_offset > 0 && hdr.vector_block_size >= (uint64_t)n * dim * sizeof(float)) {
            d->vectors = (float *)malloc((size_t)n * dim * sizeof(float));
            if (!d->vectors) { aivdb_close(d); return -1; }
            f = fopen(path, "rb");
            if (!f) { aivdb_close(d); return -1; }
            if (aivdb_fseek64(f, hdr.vector_block_offset) != 0 ||
                fread(d->vectors, dim * sizeof(float), n, f) != n) {
                fclose(f); aivdb_close(d); return -1;
            }
            fclose(f);
            d->own_vectors = 1;
        }

        if (hdr.text_blob_offset > 0 && hdr.text_blob_size > 0) {
            d->text_blob = (char *)malloc((size_t)hdr.text_blob_size + 1);
            if (!d->text_blob) { aivdb_close(d); return -1; }
            f = fopen(path, "rb");
            if (!f) { aivdb_close(d); return -1; }
            if (aivdb_fseek64(f, hdr.text_blob_offset) != 0 ||
                fread(d->text_blob, 1, (size_t)hdr.text_blob_size, f) != (size_t)hdr.text_blob_size) {
                fclose(f); aivdb_close(d); return -1;
            }
            fclose(f);
            d->own_text = 1;
            d->text_cap = hdr.text_blob_size + 1;
            d->text_blob[hdr.text_blob_size] = 0;
        }
        rebuild_inverted_from_chunks(d);
    }

    if (hdr.metadata_offset > 0 && hdr.metadata_size > 0) {
        d->metadata_blob = (char *)malloc((size_t)hdr.metadata_size + 1);
        if (!d->metadata_blob) { aivdb_close(d); return -1; }
        f = fopen(path, "rb");
        if (!f) { aivdb_close(d); return -1; }
        if (aivdb_fseek64(f, hdr.metadata_offset) != 0 ||
            fread(d->metadata_blob, 1, (size_t)hdr.metadata_size, f) != (size_t)hdr.metadata_size) {
            fclose(f); aivdb_close(d); return -1;
        }
        fclose(f);
        d->own_metadata = 1;
        d->metadata_cap = hdr.metadata_size + 1;
        d->metadata_blob[hdr.metadata_size] = 0;
    }

    *db = d;
    return 0;
}

int aivdb_flush(aivdb_t *db, const char *path) {
    if (!db || !path) return -1;
    char *tmp_path = aivdb_make_tmp_path(path, db);
    if (!tmp_path) return -1;
    FILE *f = fopen(tmp_path, "wb");
    if (!f) {
        free(tmp_path);
        return -1;
    }
    int rc = -1;

    aivdb_header_t hdr = db->header;
    uint64_t off = sizeof(aivdb_header_t);
    hdr.chunk_table_offset = off;
    hdr.chunk_table_size = (uint64_t)hdr.chunk_count * sizeof(aivdb_chunk_t);
    off += hdr.chunk_table_size;
    hdr.vector_block_offset = off;
    hdr.vector_block_size = (uint64_t)hdr.chunk_count * hdr.dim * sizeof(float);
    off += hdr.vector_block_size;
    hdr.text_blob_offset = off;
    hdr.text_blob_size = db->header.text_blob_size;
    off += hdr.text_blob_size;
    hdr.inverted_offset = 0;
    hdr.inverted_size = 0;
    if (db->header.metadata_size > 0 && db->metadata_blob) {
        hdr.metadata_offset = off;
        hdr.metadata_size = db->header.metadata_size;
        off += hdr.metadata_size;
    } else {
        hdr.metadata_offset = 0;
        hdr.metadata_size = 0;
    }
    hdr.symbol_offset = 0;
    hdr.symbol_size = 0;

    if (fwrite(&hdr, sizeof(hdr), 1, f) != 1) goto done;
    if (hdr.chunk_table_size && fwrite(db->chunks, sizeof(aivdb_chunk_t), hdr.chunk_count, f) != hdr.chunk_count) {
        goto done;
    }
    if (hdr.vector_block_size && fwrite(db->vectors, hdr.dim * sizeof(float), hdr.chunk_count, f) != hdr.chunk_count) {
        goto done;
    }
    if (hdr.text_blob_size && fwrite(db->text_blob, 1, (size_t)hdr.text_blob_size, f) != (size_t)hdr.text_blob_size) {
        goto done;
    }
    if (hdr.metadata_size && fwrite(db->metadata_blob, 1, (size_t)hdr.metadata_size, f) != (size_t)hdr.metadata_size) {
        goto done;
    }
    if (aivdb_sync_file(f) != 0) goto done;
    if (fclose(f) != 0) {
        f = NULL;
        goto done;
    }
    f = NULL;
    if (aivdb_replace_file(tmp_path, path) != 0) goto done;
    db->header = hdr;
    rc = 0;

done:
    if (f) fclose(f);
    if (rc != 0) remove(tmp_path);
    free(tmp_path);
    return rc;
}

int aivdb_close(aivdb_t *db) {
    if (!db) return -1;
    if (db->own_vectors) free(db->vectors);
    if (db->own_chunks) free(db->chunks);
    if (db->own_text) free(db->text_blob);
    if (db->own_metadata) free(db->metadata_blob);
    inverted_free(&db->inverted);
    for (uint32_t i = 0; i < db->header.doc_count; i++) {
        free(db->doc_paths[i]);
        free(db->doc_titles[i]);
    }
    free(db);
    return 0;
}

int aivdb_add_document(aivdb_t *db, const char *path, const char *title, uint32_t *out_doc_id) {
    if (!db || db->header.doc_count >= 4096) return -1;
    uint32_t id = db->header.doc_count++;
    if (path) db->doc_paths[id] = aivdb_strdup(path);
    if (title) db->doc_titles[id] = aivdb_strdup(title);
    if (out_doc_id) *out_doc_id = id;
    return 0;
}

int aivdb_add_chunk(aivdb_t *db, uint32_t doc_id, const char *text, uint32_t text_len,
                    const float *vector, uint32_t token_count, uint32_t *out_chunk_id) {
    if (!db || !text) return -1;
    uint32_t n = db->header.chunk_count;
    if (n >= AIVDB_MAX_CHUNKS) return -1;
    uint32_t dim = db->header.dim;

    if (reserve_chunks(db, n + 1) != 0) return -1;
    if (!db->text_blob) {
        if (reserve_text(db, 1) != 0) return -1;
        db->text_blob[0] = 0;
        db->header.text_blob_size = 0;
    }

    aivdb_chunk_t *chunk = &db->chunks[n];
    chunk->id = n;
    chunk->doc_id = doc_id;
    chunk->text_len = text_len;
    chunk->token_count = token_count;
    chunk->vector_index = n;
    chunk->flags = 0;

    if (db->text_blob) {
        chunk->text_offset = db->header.text_blob_size;
        if (reserve_text(db, db->header.text_blob_size + text_len + 1) != 0) return -1;
        memcpy(db->text_blob + db->header.text_blob_size, text, text_len);
        db->text_blob[db->header.text_blob_size + text_len] = 0;
        db->header.text_blob_size += (uint64_t)text_len + 1;
    }

    if (vector) {
        memcpy(db->vectors + (size_t)n * dim, vector, dim * sizeof(float));
    } else {
        memset(db->vectors + (size_t)n * dim, 0, dim * sizeof(float));
    }

    uint32_t tokens[AIVDB_TOKEN_MAX];
    uint32_t ntokens;
    tokenize_text(text, text_len, tokens, &ntokens);

    float tf_norm = (token_count > 0) ? 1.0f / (1.0f + sqrtf((float)token_count)) : 1.0f;
    ntokens = dedupe_tokens(tokens, ntokens);

    for (uint32_t t = 0; t < ntokens; t++) {
        float score = tf_norm;
        inverted_add(&db->inverted, tokens[t], n, score);
    }

    db->header.chunk_count = n + 1;
    if (out_chunk_id) *out_chunk_id = n;
    return 0;
}

int aivdb_search_vector(const aivdb_t *db, const float *query, uint32_t topk, aivdb_hit_t *out) {
    if (!db || !query || !out || db->header.chunk_count == 0 || topk == 0) return -1;
    uint32_t n = db->header.chunk_count;
    uint32_t dim = db->header.dim;
    uint32_t k = 0;

    for (uint32_t i = 0; i < n; i++) {
        const float *vec = db->vectors + (size_t)i * dim;
        float score = dot_f32(query, vec, dim);
        topk_push(out, &k, topk, i, score);
    }

    topk_sort(out, k);
    return (int)k;
}

int aivdb_search_keyword(const aivdb_t *db, const char *query, uint32_t topk, aivdb_hit_t *out) {
    if (!db || !query || !out || db->header.chunk_count == 0 || topk == 0) return -1;

    uint32_t tokens[AIVDB_TOKEN_MAX];
    uint32_t ntokens;
    uint32_t qlen = (uint32_t)strlen(query);
    tokenize_text(query, qlen, tokens, &ntokens);
    ntokens = dedupe_tokens(tokens, ntokens);
    if (ntokens == 0) return 0;

    float *scores = (float *)calloc(db->header.chunk_count, sizeof(float));
    uint32_t *touched = (uint32_t *)malloc(db->header.chunk_count * sizeof(uint32_t));
    if (!scores || !touched) {
        free(scores);
        free(touched);
        return -1;
    }
    uint32_t touched_len = 0;

    for (uint32_t t = 0; t < ntokens; t++) {
        aivdb_inverted_t *inv = (aivdb_inverted_t *)&db->inverted;
        aivdb_posting_t *post = inverted_find(inv, tokens[t]);
        if (!post) continue;
        float idf = logf(1.0f + ((float)db->header.chunk_count / (float)(post->df + 1)));
        for (uint32_t j = 0; j < post->posting_len; j++) {
            uint32_t cid = post->posting_ids[j];
            if (cid >= db->header.chunk_count) continue;
            if (scores[cid] == 0.0f) {
                touched[touched_len++] = cid;
            }
            scores[cid] += idf * post->posting_scores[j];
        }
    }

    uint32_t k = 0;
    for (uint32_t i = 0; i < touched_len; i++) {
        uint32_t cid = touched[i];
        if (scores[cid] > 0.0f) {
            topk_push(out, &k, topk, cid, scores[cid]);
        }
    }

    topk_sort(out, k);
    free(scores);
    free(touched);
    return (int)k;
}

int aivdb_search_hybrid(const aivdb_t *db, const char *query, const float *embedding,
                        float vector_weight, float keyword_weight,
                        uint32_t topk, aivdb_hit_t *out) {
    if (!db || !out || topk == 0) return -1;

    aivdb_hit_t *vec_hits = NULL;
    aivdb_hit_t *kw_hits = NULL;
    int vec_k = 0, kw_k = 0;
    uint32_t candidate_cap = topk * 2;
    if (candidate_cap < topk) return -1;
    aivdb_hit_t *candidates = (aivdb_hit_t *)calloc(candidate_cap, sizeof(aivdb_hit_t));
    if (!candidates) return -1;
    uint32_t candidate_len = 0;

    if (embedding && vector_weight > 0) {
        vec_hits = (aivdb_hit_t *)malloc(topk * sizeof(aivdb_hit_t));
        vec_k = aivdb_search_vector(db, embedding, topk, vec_hits);
        for (int i = 0; i < vec_k; i++) {
            float norm_score = 1.0f / (1.0f + expf(-vec_hits[i].score));
            uint32_t cid = vec_hits[i].chunk_id;
            uint32_t j = 0;
            for (; j < candidate_len; j++) {
                if (candidates[j].chunk_id == cid) {
                    candidates[j].score += vector_weight * norm_score;
                    break;
                }
            }
            if (j == candidate_len && candidate_len < candidate_cap) {
                candidates[candidate_len].chunk_id = cid;
                candidates[candidate_len].score = vector_weight * norm_score;
                candidate_len++;
            }
        }
    }

    if (query && keyword_weight > 0) {
        kw_hits = (aivdb_hit_t *)malloc(topk * sizeof(aivdb_hit_t));
        kw_k = aivdb_search_keyword(db, query, topk, kw_hits);
        for (int i = 0; i < kw_k; i++) {
            float norm_score = kw_hits[i].score / (1.0f + kw_hits[i].score);
            uint32_t cid = kw_hits[i].chunk_id;
            uint32_t j = 0;
            for (; j < candidate_len; j++) {
                if (candidates[j].chunk_id == cid) {
                    candidates[j].score += keyword_weight * norm_score;
                    break;
                }
            }
            if (j == candidate_len && candidate_len < candidate_cap) {
                candidates[candidate_len].chunk_id = cid;
                candidates[candidate_len].score = keyword_weight * norm_score;
                candidate_len++;
            }
        }
    }

    uint32_t k = 0;
    for (uint32_t i = 0; i < candidate_len; i++) {
        if (candidates[i].score > 0.0f) {
            topk_push(out, &k, topk, candidates[i].chunk_id, candidates[i].score);
        }
    }

    topk_sort(out, k);
    free(candidates);
    free(vec_hits);
    free(kw_hits);
    return (int)k;
}

uint32_t aivdb_chunk_count(const aivdb_t *db) {
    return db ? db->header.chunk_count : 0;
}

uint32_t aivdb_dim(const aivdb_t *db) {
    return db ? db->header.dim : 0;
}

const char *aivdb_chunk_text(const aivdb_t *db, uint32_t chunk_id) {
    if (!db || chunk_id >= db->header.chunk_count || !db->text_blob) return NULL;
    return db->text_blob + db->chunks[chunk_id].text_offset;
}

int aivdb_set_metadata(aivdb_t *db, const char *metadata, uint64_t metadata_size) {
    if (!db) return -1;
    if (!metadata || metadata_size == 0) {
        if (db->own_metadata) free(db->metadata_blob);
        db->metadata_blob = NULL;
        db->metadata_cap = 0;
        db->own_metadata = 0;
        db->header.metadata_size = 0;
        db->header.metadata_offset = 0;
        return 0;
    }
    if (reserve_metadata(db, metadata_size + 1) != 0) return -1;
    memcpy(db->metadata_blob, metadata, (size_t)metadata_size);
    db->metadata_blob[metadata_size] = 0;
    db->header.metadata_size = metadata_size;
    return 0;
}

const char *aivdb_metadata(const aivdb_t *db) {
    if (!db || !db->metadata_blob || db->header.metadata_size == 0) return NULL;
    return db->metadata_blob;
}

uint64_t aivdb_metadata_size(const aivdb_t *db) {
    return db ? db->header.metadata_size : 0;
}

int aivdb_load_synthetic(aivdb_t *db, uint32_t nchunks, const float *vectors_block, uint32_t seed) {
    if (!db) return -1;
    if (nchunks > AIVDB_MAX_CHUNKS) return -1;
    uint32_t dim = db->header.dim;

    if (db->own_vectors) free(db->vectors);
    if (db->own_chunks) free(db->chunks);
    if (db->own_text) free(db->text_blob);
    if (db->own_metadata) free(db->metadata_blob);
    for (uint32_t i = 0; i < db->header.doc_count && i < 4096; i++) {
        free(db->doc_paths[i]);
        free(db->doc_titles[i]);
        db->doc_paths[i] = NULL;
        db->doc_titles[i] = NULL;
    }
    inverted_free(&db->inverted);
    db->vectors = NULL;
    db->chunks = NULL;
    db->text_blob = NULL;
    db->metadata_blob = NULL;
    db->chunk_cap = 0;
    db->text_cap = 0;
    db->metadata_cap = 0;
    db->own_vectors = 0;
    db->own_chunks = 0;
    db->own_text = 0;
    db->own_metadata = 0;
    db->header.metadata_offset = 0;
    db->header.metadata_size = 0;

    db->header.chunk_count = nchunks;
    db->header.doc_count = 1;
    db->doc_paths[0] = aivdb_strdup("synthetic");
    db->doc_titles[0] = aivdb_strdup("Synthetic Benchmark Data");

    if (vectors_block) {
        db->vectors = (float *)vectors_block;
        db->own_vectors = 0;
    } else {
        db->vectors = (float *)malloc((size_t)nchunks * dim * sizeof(float));
        db->own_vectors = 1;
        srand(seed);
        for (uint32_t i = 0; i < nchunks; i++) {
            float *v = db->vectors + (size_t)i * dim;
            float n = 0;
            for (uint32_t d = 0; d < dim; d++) {
                v[d] = (float)rand() / RAND_MAX - 0.5f;
                n += v[d] * v[d];
            }
            n = sqrtf(n);
            if (n > 0) for (uint32_t d = 0; d < dim; d++) v[d] /= n;
        }
    }

    db->chunks = (aivdb_chunk_t *)calloc(nchunks, sizeof(aivdb_chunk_t));
    db->own_chunks = 1;
    db->chunk_cap = nchunks;
    for (uint32_t i = 0; i < nchunks; i++) {
        db->chunks[i].id = i;
        db->chunks[i].doc_id = 0;
        db->chunks[i].vector_index = i;
    }

    inverted_init(&db->inverted);
    const char *kw[] = {"test", "benchmark", "vector", "search", "chunk", "data"};
    for (int w = 0; w < 6; w++) {
        uint32_t th = fnv1a(kw[w], (uint32_t)strlen(kw[w]));
        for (uint32_t c = 0; c < nchunks; c += (nchunks > 10 ? nchunks/10 : 1)) {
            inverted_add(&db->inverted, th, c, 1.0f);
        }
    }

    return 0;
}
