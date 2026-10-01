# 🚀 Dokumentasi API Service Katamereka (Khusus Frontend Developer)

Dokumen ini berisi daftar endpoint lengkap beserta URL, HTTP Method, Headers, serta contoh Payload Request & Response untuk integrasi Halaman Profil Customer, Bisnis Favorit, Riwayat Penelusuran, dan Customer Logs di Frontend (`katamereka.id`).

---

## 🔐 Base URL & Autentikasi

* **Base URL**: `http://localhost:3000` (Local Dev) / `https://api.katamereka.id` (Production)
* **Authentication Header**: Semua endpoint di bawah ini membutuhkan Token Bearer JWT:
  ```http
  Authorization: Bearer <accessToken_user>
  Content-Type: application/json
  ```

---

## 1. 👤 Halaman Profil Customer (`katamereka.id/profile`)

### 1.1 Header Profil & Ringkasan Aktivitas
Mengambil data identitas pengguna serta statistik jumlah ulasan dan bisnis yang disimpan untuk mengisi kartu header profil.

* **HTTP Method**: `GET`
* **URL**: `/profile/summary`
* **Headers**: `Authorization: Bearer <token>`
* **Response `200 OK`**:
  ```json
  {
    "success": true,
    "message": "Berhasil mengambil ringkasan profil customer",
    "data": {
      "user": {
        "id": "6d6f5b3b-f7df-4989-a68b-d3b0c4039104",
        "name": "Ardhy Ps",
        "email": "ardhyputerasetiawan@gmail.com",
        "isVerified": true,
        "createdAt": "2026-09-23T03:18:48.687Z"
      },
      "stats": {
        "totalReviews": 1,
        "totalHelpfulVotes": 5,
        "totalSavedBusinesses": 1
      }
    }
  }
  ```

---

### 1.2 Tab 1: Review Saya (My Reviews)
Mengambil daftar seluruh ulasan/review yang pernah ditulis oleh pengguna yang sedang login.

* **HTTP Method**: `GET`
* **URL**: `/my-reviews`
* **Headers**: `Authorization: Bearer <token>`
* **Response `200 OK`**:
  ```json
  {
    "success": true,
    "message": "Berhasil mengambil ulasan milik pengguna",
    "data": [
      {
        "id": "559a2482-fd09-468f-ae57-584710a0b80b",
        "rating": 5,
        "title": "Pelayanan Sangat Nyaman",
        "content": "Tempatnya bersih, fasilitas lengkap, dan pelayanan staf sangat ramah!",
        "status": "APPROVED",
        "createdAt": "2026-09-24T01:24:10.931Z",
        "updatedAt": "2026-09-28T01:14:02.338Z",
        "business": {
          "id": "3d9c96e0-1b44-435f-87ca-83fea92a39ee",
          "name": "Antapani Home Stay & Cafe Bandung",
          "slug": "antapani-home-stay",
          "category": "Home Stay",
          "address": "Jl. Terusan Jakarta No. 45",
          "city": "Bandung",
          "logoUrl": null
        }
      }
    ]
  }
  ```

---

## 2. ❤️ Bisnis Favorit / Tersimpan (Favorite Businesses)

### 2.1 Tab 2: Mengambil Daftar Bisnis Tersimpan
Mengambil daftar bisnis yang di-favorite / di-bookmark oleh pengguna.

* **HTTP Method**: `GET`
* **URL**: `/my-favorites`
* **Headers**: `Authorization: Bearer <token>`
* **Response `200 OK`**:
  ```json
  {
    "success": true,
    "message": "Berhasil mengambil daftar bisnis favorit",
    "data": [
      {
        "favoriteId": "eb142fb4-aa14-4dde-8435-84b2d15bd97d",
        "favoritedAt": "2026-09-29T23:16:49.062Z",
        "business": {
          "id": "93411df3-82e4-4dd6-8b29-9218099237dc",
          "name": "Hotel All Sedayu Kelapa Gading",
          "slug": "hotel-all-sedayu-kelapa-gading",
          "category": "accommodation.hotel",
          "address": "Hotel All Sedayu Kelapa Gading",
          "city": "North Jakarta",
          "province": "Java",
          "country": "Indonesia",
          "externalRating": "4.50",
          "externalReviewsCount": 12,
          "averageRating": null,
          "reviewCount": 0,
          "logoUrl": null,
          "coverUrl": null
        }
      }
    ]
  }
  ```

---

### 2.2 Toggle Favoritkan Bisnis (Save / Favorite)
Menyimpan bisnis ke daftar favorit (atau membatalkannya jika menggunakan sistem Toggle).

* **HTTP Method**: `POST`
* **URL**: `/businesses/:businessId/favorite`
* **Headers**: `Authorization: Bearer <token>`
* **Response `200 OK` (Ketika Menfavoritkan)**:
  ```json
  {
    "success": true,
    "message": "Bisnis berhasil ditambahkan ke daftar favorit",
    "isFavorite": true
  }
  ```

---

### 2.3 Menghapus Bisnis dari Favorit (Unfavorite)
Endpoint eksplisit `DELETE` untuk menghapus bisnis dari daftar favorit.

* **HTTP Method**: `DELETE`
* **URL**: `/businesses/:businessId/favorite`
* **Headers**: `Authorization: Bearer <token>`
* **Response `200 OK`**:
  ```json
  {
    "success": true,
    "message": "Bisnis berhasil dihapus dari daftar favorit",
    "isFavorite": false
  }
  ```

---

## 3. 🕒 Riwayat Penelusuran ("Pick Up Where You Left Off")

### 3.1 Mengambil Riwayat Bisnis Terakhir Dilihat
Mengambil daftar maksimal 30 bisnis yang baru saja dilihat oleh pengguna.

* **HTTP Method**: `GET`
* **URL**: `/my-recently-viewed?limit=30`
* **Headers**: `Authorization: Bearer <token>`
* **Response `200 OK`**:
  ```json
  {
    "success": true,
    "message": "Berhasil mengambil riwayat bisnis yang baru dilihat",
    "data": [
      {
        "id": "93411df3-82e4-4dd6-8b29-9218099237dc",
        "name": "Hotel All Sedayu Kelapa Gading",
        "slug": "hotel-all-sedayu-kelapa-gading",
        "category": "accommodation.hotel",
        "city": "North Jakarta",
        "province": "Java",
        "country": "Indonesia",
        "externalRating": "4.50",
        "viewedAt": "2026-09-29T10:19:56.495Z"
      }
    ]
  }
  ```

---

### 3.2 Mencatat Riwayat View Bisnis (Manual Trigger)
Mencatat bahwa pengguna melihat bisnis tertentu (Catatan: Ini juga terpicu otomatis saat memanggil `GET /businesses/:id` dengan Token Bearer).

* **HTTP Method**: `POST`
* **URL**: `/businesses/:businessId/view`
* **Headers**: `Authorization: Bearer <token>`
* **Response `201 Created`**:
  ```json
  {
    "success": true,
    "message": "Berhasil mencatat riwayat penelusuran bisnis"
  }
  ```

---

## 4. 📜 Tab 3: Aktivitas Terbaru (Customer Logs)

### 4.1 Mengambil Audit Trail Log Aktivitas Customer
Mengambil jejak rekam aktivitas terbaru pengguna (misal: saat menfavoritkan, menghapus favorit, menulis review, dll).

* **HTTP Method**: `GET`
* **URL**: `/customer-logs/my-logs?limit=50`
* **Headers**: `Authorization: Bearer <token>`
* **Response `200 OK`**:
  ```json
  {
    "success": true,
    "message": "Berhasil mengambil daftar log aktivitas customer",
    "data": [
      {
        "id": "6caf7822-9049-426a-bcbb-ca293bb3d880",
        "userId": "6d6f5b3b-f7df-4989-a68b-d3b0c4039104",
        "actionType": "CREATE",
        "data": {
          "action": "FAVORITE_BUSINESS",
          "businessId": "93411df3-82e4-4dd6-8b29-9218099237dc",
          "businessName": "Hotel All Sedayu Kelapa Gading"
        },
        "createdAt": "2026-09-29T23:16:49.138Z"
      },
      {
        "id": "5c7fb518-16a6-40c5-bfba-a0f4cc2e1e5e",
        "userId": "6d6f5b3b-f7df-4989-a68b-d3b0c4039104",
        "actionType": "DELETE",
        "data": {
          "action": "UNFAVORITE_BUSINESS",
          "businessId": "93411df3-82e4-4dd6-8b29-9218099237dc",
          "businessName": "Hotel All Sedayu Kelapa Gading"
        },
        "createdAt": "2026-09-29T23:18:00.000Z"
      }
    ]
  }
  ```

---

## 5. 🏨 Pencarian Tempat Bisnis & Auto-Upload Foto S3 (`/business-places/search`)

### 5.1 Pencarian Bisnis dengan Dynamic Fallback & Auto-Save ke AWS S3
Endpoint ini digunakan untuk mencari daftar tempat bisnis (hotel, restoran, tempat wisata, dll) secara real-time berdasarkan kata kunci dan lokasi. Foto gedung asli bisnis ditarik dari Google Maps dan **otomatis di-upload ke AWS S3 Bucket internal** (`https://transgo-minio.s3.ap-southeast-1.amazonaws.com`).

* **HTTP Method**: `GET`
* **URL**: `/business-places/search`
* **Query Parameters**:
  * `keyword` *(string, optional)*: Kata kunci pencarian (contoh: `hotel`, `restoran`, `cafe`). Default: `hotel`.
  * `location` *(string, optional)*: Area kota/lokasi pencarian (contoh: `Bandung`, `Jakarta`, `Surabaya`). Default: `Bandung`.
  * `limit` *(number, optional)*: Jumlah maksimal data yang ingin diambil. Default: `20`.
* **Headers**:
  ```http
  Content-Type: application/json
  ```

#### **Response `200 OK`**:
```json
{
  "success": true,
  "message": "Berhasil mengambil daftar tempat bisnis dengan hierarki fallback",
  "total": 20,
  "data": [
    {
      "id": "51951617eef2e65a40597d5d372720c81bc0f00102f901a00daf25000000009203134462657374204578707265737320486f74656c",
      "name": "Dbest Express Hotel",
      "address": "Dbest Express Hotel, Jalan Madurasa Tengah, Cigereleng, Bandung City 40243, West Java, Indonesia",
      "latitude": -6.9454351,
      "longitude": 107.6085772,
      "categories": [
        "accommodation",
        "accommodation.hotel",
        "building",
        "building.accommodation"
      ],
      "imageUrl": "https://transgo-minio.s3.ap-southeast-1.amazonaws.com/kabarify/places/place_51951617eef2e65a40597d5d372720c81bc0f001.jpg",
      "imageSource": "google_internal",
      "dataSource": "geoapify"
    },
    {
      "id": "512d8e500313e65a4059cda9113642c81bc0f00102f901b213e725000000009203144c6f736d656e204c657577692050616e6a616e67",
      "name": "Losmen Leuwi Panjang",
      "address": "Losmen Leuwi Panjang, Jalur Masuk Bus, Situ Saeur, Bandung City 40236, West Java, Indonesia",
      "latitude": -6.9455653,
      "longitude": 107.5949104,
      "categories": [
        "accommodation",
        "accommodation.hotel"
      ],
      "imageUrl": "https://transgo-minio.s3.ap-southeast-1.amazonaws.com/kabarify/places/place_512d8e500313e65a4059cda9113642c81bc0f001.jpg",
      "imageSource": "google_internal",
      "dataSource": "geoapify"
    }
  ]
}
```

#### **Penjelasan Field Response**:
| Field | Tipe Data | Deskripsi |
| :--- | :--- | :--- |
| `id` | `string` | Unique ID tempat bisnis dari provider |
| `name` | `string` | Nama resmi tempat bisnis |
| `address` | `string` | Alamat fisik lengkap bisnis |
| `latitude` | `number` | Koordinat Latitude lokasi bisnis |
| `longitude` | `number` | Koordinat Longitude lokasi bisnis |
| `categories` | `string[]` | Daftar kategori/jenis tempat bisnis |
| `imageUrl` | `string` | URL foto gedung bisnis asli yang **tersimpan di AWS S3 internal** |
| `imageSource` | `string` | Sumber foto (`google_internal`, `wikimedia`, `foursquare`, `geoapify_map`) |
| `dataSource` | `string` | Provider data lokasi utama (`geoapify` / `google_places`) |

