# CMS Internal --- Database & ERD Specification

## 1. Tujuan

CMS (Content Management System) internal digunakan untuk mengelola
konten secara terstruktur, mudah dikembangkan, dan dapat digunakan dalam
jangka panjang.

Sistem dirancang agar dapat mendukung:

-   Pembuatan dan pengelolaan konten.
-   Draft, review, scheduling, publishing, dan archive.
-   Category dan subcategory.
-   Tags.
-   SEO metadata per konten.
-   Media / asset management.
-   Riwayat perubahan (revision).
-   Author / user yang membuat dan mengubah konten.
-   Pengembangan workflow dan permission di masa depan.

------------------------------------------------------------------------

## 2. Prinsip Struktur

Beberapa prinsip utama:

1.  **Content menjadi entity utama.**
2.  **SEO dipisahkan dari content** agar metadata SEO dapat berkembang
    tanpa membuat tabel content terlalu besar.
3.  **Tag menggunakan relasi many-to-many.**
4.  **Category dapat menggunakan hierarchy** melalui `parent_id`.
5.  **Category ↔ Content menggunakan many-to-many** apabila satu konten
    boleh memiliki lebih dari satu kategori.
6.  **Media disimpan sebagai entity tersendiri**, bukan sekadar URL di
    tabel content.
7.  **Revision disimpan terpisah** agar perubahan dapat dilacak dan
    nantinya mendukung rollback.
8.  **Status content tidak menggunakan boolean** seperti `is_published`,
    tetapi menggunakan lifecycle/status yang jelas.
9.  Gunakan foreign key, unique constraint, dan index pada kolom yang
    relevan.

------------------------------------------------------------------------

## 3. ERD Utama

``` text
USERS
  │
  │ 1:N
  ▼
CONTENTS
  │
  ├──── 1:1 ──── CONTENT_SEO
  │
  ├──── 1:N ──── CONTENT_REVISIONS
  │
  ├──── N:M ──── CATEGORIES
  │
  ├──── N:M ──── TAGS
  │
  └──── N:1 ──── MEDIA
                   ↑
              Featured Image
```

Junction table:

``` text
CONTENTS ──< CONTENT_CATEGORIES >── CATEGORIES

CONTENTS ──< CONTENT_TAGS >──────── TAGS
```

------------------------------------------------------------------------

# 4. Daftar Tabel

## 4.1 `users`

Menyimpan user internal yang dapat membuat atau mengelola konten.

  Field        Type / Konsep     Keterangan
  ------------ ----------------- ---------------------
  id           PK                ID user
  name         varchar           Nama user
  email        varchar, unique   Email
  status       enum/boolean      Status akun
  created_at   timestamp         Dibuat
  updated_at   timestamp         Terakhir diperbarui

> Role dan permission dapat dibuat sebagai modul terpisah apabila
> kebutuhan akses CMS semakin kompleks.

------------------------------------------------------------------------

## 4.2 `contents`

Entity utama untuk semua konten editorial.

  Field               Type / Konsep             Keterangan
  ------------------- ------------------------- ----------------
  id                  PK                        ID content
  author_id           FK → users.id             Pembuat/author
  title               varchar                   Judul
  slug                varchar, unique           URL slug
  excerpt             text, nullable            Ringkasan
  body                longtext/text             Isi content
  featured_media_id   FK → media.id, nullable   Featured image
  status              enum                      Status content
  published_at        timestamp, nullable       Waktu publish
  created_at          timestamp                 Dibuat
  updated_at          timestamp                 Diperbarui
  deleted_at          timestamp, nullable       Soft delete

### Content Status

Status yang disarankan:

``` text
DRAFT
IN_REVIEW
SCHEDULED
PUBLISHED
ARCHIVED
```

Flow dasar:

``` text
DRAFT
  ↓
IN_REVIEW
  ↓
SCHEDULED
  ↓
PUBLISHED
  ↓
ARCHIVED
```

`SCHEDULED` digunakan apabila `published_at` berada di masa depan.

------------------------------------------------------------------------

## 4.3 `content_seo`

Menyimpan konfigurasi SEO untuk setiap content.

Relasi:

``` text
CONTENTS 1 ───── 1 CONTENT_SEO
```

  Field              Type / Konsep             Keterangan
  ------------------ ------------------------- ------------------------
  id                 PK                        ID SEO
  content_id         FK, unique                Content terkait
  meta_title         varchar, nullable         SEO title
  meta_description   text, nullable            SEO description
  canonical_url      varchar, nullable         Canonical URL
  robots_index       boolean                   Index / noindex
  robots_follow      boolean                   Follow / nofollow
  og_title           varchar, nullable         Open Graph title
  og_description     text, nullable            Open Graph description
  og_media_id        FK → media.id, nullable   Open Graph image
  created_at         timestamp                 Dibuat
  updated_at         timestamp                 Diperbarui

### Fallback SEO

Jika editor tidak mengisi SEO secara manual:

``` text
meta_title
→ fallback ke contents.title

meta_description
→ fallback ke contents.excerpt

og_title
→ fallback ke meta_title / contents.title

og_description
→ fallback ke meta_description / contents.excerpt

og_image
→ fallback ke featured_media
```

Dengan begitu SEO tidak harus selalu diisi manual.

------------------------------------------------------------------------

## 4.4 `categories`

Digunakan untuk mengelompokkan content secara terstruktur.

  Field         Type / Konsep                  Keterangan
  ------------- ------------------------------ -----------------
  id            PK                             ID category
  name          varchar                        Nama category
  slug          varchar, unique                Slug
  description   text, nullable                 Deskripsi
  parent_id     FK → categories.id, nullable   Parent category
  created_at    timestamp                      Dibuat
  updated_at    timestamp                      Diperbarui

`parent_id` memungkinkan hierarchy tanpa membuat tabel subcategory
terpisah.

Contoh:

``` text
Teknologi
├── Artificial Intelligence
├── Software
└── Gadget

Bisnis
├── Marketing
├── Finance
└── Management
```

Jika tidak memiliki parent:

``` text
parent_id = NULL
```

------------------------------------------------------------------------

## 4.5 `content_categories`

Pivot/junction table antara content dan category.

  Field         Type / Konsep
  ------------- --------------------
  content_id    FK → contents.id
  category_id   FK → categories.id

Constraint:

``` text
UNIQUE(content_id, category_id)
```

Relasi:

``` text
CONTENTS N ───── M CATEGORIES
```

> Jika aturan bisnis memastikan satu content hanya boleh memiliki satu
> category, tabel ini dapat disederhanakan menjadi `category_id` pada
> `contents`. Gunakan junction table hanya jika multi-category memang
> dibutuhkan.

------------------------------------------------------------------------

## 4.6 `tags`

Digunakan untuk label/topik yang lebih fleksibel dibanding category.

  Field        Type / Konsep     Keterangan
  ------------ ----------------- ------------
  id           PK                ID tag
  name         varchar           Nama tag
  slug         varchar, unique   Slug
  created_at   timestamp         Dibuat
  updated_at   timestamp         Diperbarui

Contoh:

``` text
Category:
Technology

Tags:
AI
ChatGPT
Automation
Productivity
```

Category digunakan sebagai klasifikasi utama, sedangkan tags membantu
menghubungkan content berdasarkan topik yang lebih spesifik.

------------------------------------------------------------------------

## 4.7 `content_tags`

Pivot/junction table antara content dan tag.

  Field        Type / Konsep
  ------------ ------------------
  content_id   FK → contents.id
  tag_id       FK → tags.id

Constraint:

``` text
UNIQUE(content_id, tag_id)
```

Relasi:

``` text
CONTENTS N ───── M TAGS
```

------------------------------------------------------------------------

## 4.8 `media`

Media library CMS.

  Field           Type / Konsep            Keterangan
  --------------- ------------------------ --------------------
  id              PK                       ID media
  filename        varchar                  Nama file internal
  original_name   varchar                  Nama file asli
  url             varchar                  Lokasi asset
  mime_type       varchar                  Tipe file
  size            bigint                   Ukuran file
  width           integer, nullable        Lebar image
  height          integer, nullable        Tinggi image
  alt_text        varchar/text, nullable   Alt text
  uploaded_by     FK → users.id            Uploader
  created_at      timestamp                Waktu upload
  updated_at      timestamp                Diperbarui

Contoh penggunaan media:

-   Featured image
-   Open Graph image
-   Image di dalam artikel
-   Asset CMS lainnya

Storage file dapat menggunakan object storage/CDN, sedangkan tabel ini
menyimpan metadata dan referensinya.

------------------------------------------------------------------------

## 4.9 `content_revisions`

Menyimpan histori perubahan content.

  Field             Type / Konsep      Keterangan
  ----------------- ------------------ -----------------------------
  id                PK                 ID revision
  content_id        FK → contents.id   Content
  revision_number   integer            Nomor revision
  title             varchar            Snapshot title
  excerpt           text               Snapshot excerpt
  body              longtext/text      Snapshot body
  created_by        FK → users.id      User yang membuat perubahan
  created_at        timestamp          Waktu revision

Constraint yang disarankan:

``` text
UNIQUE(content_id, revision_number)
```

Contoh:

``` text
Content #120

Revision 1
   ↓
Revision 2
   ↓
Revision 3
   ↓
Current Content
```

Revision memungkinkan fitur history dan rollback dikembangkan tanpa
mengubah struktur utama content.

------------------------------------------------------------------------

# 5. Relationship Summary

  Entity       Relationship   Entity
  ------------ -------------- ---------------------------
  Users        1:N            Contents
  Users        1:N            Media
  Contents     1:1            Content SEO
  Contents     1:N            Content Revisions
  Contents     N:M            Categories
  Contents     N:M            Tags
  Media        1:N            Contents (featured media)
  Categories   1:N            Categories (parent-child)

------------------------------------------------------------------------

# 6. Struktur Final

``` text
CMS
│
├── USERS
│
├── CONTENT
│   ├── contents
│   ├── content_seo
│   └── content_revisions
│
├── TAXONOMY
│   ├── categories
│   ├── content_categories
│   ├── tags
│   └── content_tags
│
└── MEDIA
    └── media
```

Total core table:

``` text
1. users
2. contents
3. content_seo
4. content_revisions
5. categories
6. content_categories
7. tags
8. content_tags
9. media
```

------------------------------------------------------------------------

# 7. Index & Constraint yang Disarankan

Minimal:

``` text
users.email
→ UNIQUE

contents.slug
→ UNIQUE

contents.author_id
→ INDEX

contents.status
→ INDEX

contents.published_at
→ INDEX

content_seo.content_id
→ UNIQUE

categories.slug
→ UNIQUE

categories.parent_id
→ INDEX

tags.slug
→ UNIQUE

content_categories(content_id, category_id)
→ UNIQUE

content_tags(content_id, tag_id)
→ UNIQUE

content_revisions(content_id, revision_number)
→ UNIQUE
```

Index tambahan dapat dibuat berdasarkan pola query aktual setelah sistem
mulai digunakan.

------------------------------------------------------------------------

# 8. Scope MVP

Untuk versi pertama, fitur yang sudah cukup:

``` text
✓ Create Content
✓ Edit Content
✓ Delete / Soft Delete
✓ Draft
✓ Publish
✓ Schedule Publish

✓ Category
✓ Subcategory
✓ Tags

✓ Featured Image
✓ Media Library

✓ Meta Title
✓ Meta Description
✓ Canonical URL
✓ Index / Noindex
✓ Follow / Nofollow
✓ Open Graph Metadata

✓ Revision History
```

Tidak perlu langsung membuat semua fitur enterprise.

------------------------------------------------------------------------

# 9. Future Development

Struktur ini dapat dikembangkan kemudian dengan modul tambahan tanpa
mengubah fondasi utama, misalnya:

``` text
roles
permissions
role_permissions

content_approvals
content_comments

audit_logs

redirects

content_localizations

content_relations
```

Contoh pengembangan workflow:

``` text
Writer
  ↓
Create Draft
  ↓
Submit Review
  ↓
Editor Review
  ↓
Approve / Revision
  ↓
Schedule
  ↓
Publish
```

Fitur-fitur tersebut sebaiknya ditambahkan ketika requirement bisnis
memang sudah membutuhkannya, bukan semuanya sejak awal.

------------------------------------------------------------------------

# 10. Kesimpulan

Fondasi CMS terdiri dari empat domain utama:

``` text
CONTENT
TAXONOMY
SEO
MEDIA
```

dengan `users` sebagai actor dan `content_revisions` sebagai histori.

Struktur ini menjaga data tetap terpisah berdasarkan tanggung jawabnya,
tetapi tidak membuat CMS terlalu kompleks untuk versi awal. Category dan
tags dapat berkembang, SEO mempunyai konfigurasi sendiri, media
reusable, dan content mempunyai lifecycle serta revision history yang
jelas.
