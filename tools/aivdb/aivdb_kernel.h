#ifndef AIVDB_KERNEL_H
#define AIVDB_KERNEL_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

#define AIVDB_MAGIC "AIVDB001"
#define AIVDB_VERSION 2
#define AIVDB_DIM_MAX 4096
#define AIVDB_DIM_DEFAULT 768

typedef struct {
    char magic[8];
    uint32_t version;
    uint32_t dim;
    uint32_t chunk_count;
    uint32_t doc_count;
    uint32_t token_count;
    uint64_t text_blob_offset;
    uint64_t text_blob_size;
    uint64_t vector_block_offset;
    uint64_t vector_block_size;
    uint64_t chunk_table_offset;
    uint64_t chunk_table_size;
    uint64_t inverted_offset;
    uint64_t inverted_size;
    uint64_t metadata_offset;
    uint64_t metadata_size;
    uint64_t symbol_offset;
    uint64_t symbol_size;
    uint64_t reserved[6];
} aivdb_header_t;

typedef struct {
    uint32_t id;
    uint32_t doc_id;
    uint64_t text_offset;
    uint32_t text_len;
    uint32_t token_count;
    uint32_t vector_index;
    uint32_t flags;
} aivdb_chunk_t;

typedef struct {
    uint32_t chunk_id;
    float score;
} aivdb_hit_t;

typedef struct aivdb_t aivdb_t;

int  aivdb_open(const char *path, aivdb_t **db);
int  aivdb_close(aivdb_t *db);
int  aivdb_create(const char *path, uint32_t dim);
int  aivdb_flush(aivdb_t *db, const char *path);
int  aivdb_add_chunk(aivdb_t *db, uint32_t doc_id, const char *text, uint32_t text_len,
                     const float *vector, uint32_t token_count, uint32_t *out_chunk_id);
int  aivdb_search_vector(const aivdb_t *db, const float *query, uint32_t topk, aivdb_hit_t *out);
int  aivdb_search_keyword(const aivdb_t *db, const char *query, uint32_t topk, aivdb_hit_t *out);
int  aivdb_search_hybrid(const aivdb_t *db, const char *query, const float *embedding,
                         float vector_weight, float keyword_weight,
                         uint32_t topk, aivdb_hit_t *out);
uint32_t aivdb_chunk_count(const aivdb_t *db);
uint32_t aivdb_dim(const aivdb_t *db);
const char *aivdb_chunk_text(const aivdb_t *db, uint32_t chunk_id);
int  aivdb_set_metadata(aivdb_t *db, const char *metadata, uint64_t metadata_size);
const char *aivdb_metadata(const aivdb_t *db);
uint64_t aivdb_metadata_size(const aivdb_t *db);
int  aivdb_add_document(aivdb_t *db, const char *path, const char *title, uint32_t *out_doc_id);
int  aivdb_load_synthetic(aivdb_t *db, uint32_t nchunks, const float *vectors_block, uint32_t seed);

#ifdef __cplusplus
}
#endif

#endif
