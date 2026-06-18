const docx = require("docx");
const fs = require("fs");

// ============================================================
// SOP PUSHAKIN FLOWS — Document Generation
// ============================================================

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, ShadingType, PageBreak, TableOfContents,
  Header, Footer, PageNumber, NumberFormat,
  Tab, TabStopType, TabStopPosition,
  ImageRun, ExternalHyperlink,
  convertInchesToTwip, convertMillimetersToTwip,
} = docx;

// === Color Palette (Professional Blue-Grey) ===
const C = {
  primary: "1a365d",      // dark navy
  secondary: "2c5282",    // medium blue
  accent: "e53e3e",       // red accent
  text: "1a202c",         // near-black
  textLight: "4a5568",    // grey
  textMuted: "718096",    // light grey
  bg: "f7fafc",          // very light blue-grey
  white: "FFFFFF",
  tableBorder: "cbd5e0",
  tableHeader: "edf2f7",
  tableAlt: "f8fafc",
  green: "276749",
  amber: "92400e",
  blue: "2b6cb0",
};

// === Font ===
const FONT = "Calibri";

// === Helper Functions ===
function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({
    heading: level,
    spacing: { before: level === HeadingLevel.HEADING_1 ? 360 : 240, after: 120, line: 312 },
    children: [new TextRun({ text, font: FONT, size: level === HeadingLevel.HEADING_1 ? 28 : level === HeadingLevel.HEADING_2 ? 24 : 22, bold: true, color: C.primary })],
  });
}

function para(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120, line: 312 },
    alignment: opts.align || AlignmentType.JUSTIFIED,
    indent: opts.indent ? { firstLine: 480 } : undefined,
    ...opts.extra,
    children: Array.isArray(text)
      ? text
      : [new TextRun({ text, font: FONT, size: 22, color: opts.color || C.text })],
  });
}

function bold(text, rest = "") {
  return [
    new TextRun({ text, font: FONT, size: 22, color: C.text, bold: true }),
    ...(rest ? [new TextRun({ text: rest, font: FONT, size: 22, color: C.text })] : []),
  ];
}

function bullet(text, level = 0) {
  const items = Array.isArray(text) ? text : [text];
  return items.map(t =>
    new Paragraph({
      spacing: { after: 60, line: 312 },
      indent: { left: convertMillimetersToTwip(12 + level * 8), hanging: convertMillimetersToTwip(5) },
      children: [new TextRun({ text: "\u2022  " + t, font: FONT, size: 22, color: C.text })],
    })
  );
}

function numberedItem(num, text) {
  const items = Array.isArray(text) ? text : [text];
  return items.map(t =>
    new Paragraph({
      spacing: { after: 60, line: 312 },
      indent: { left: convertMillimetersToTwip(12), hanging: convertMillimetersToTwip(6) },
      children: [new TextRun({ text: `${num}.  ${t}`, font: FONT, size: 22, color: C.text })],
    })
  );
}

function emptyLine() {
  return new Paragraph({ spacing: { after: 60 }, children: [] });
}

// Table helper
function makeTable(headers, rows) {
  const colCount = headers.length;
  const colWidth = Math.floor(9000 / colCount);
  
  const headerRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: headers.map(h => new TableCell({
      shading: { type: ShadingType.CLEAR, fill: C.primary },
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [new Paragraph({
        spacing: { line: 276 },
        children: [new TextRun({ text: h, font: FONT, size: 20, bold: true, color: C.white })],
      })],
      width: { size: colWidth, type: WidthType.DXA },
    })),
  });

  const dataRows = rows.map((row, ri) =>
    new TableRow({
      cantSplit: true,
      children: row.map((cell, ci) => {
        const isText = typeof cell === "string";
        const content = isText ? cell : cell.text;
        const bold_ = isText ? false : !!cell.bold;
        const color_ = isText ? C.text : (cell.color || C.text);
        return new TableCell({
          shading: { type: ShadingType.CLEAR, fill: ri % 2 === 0 ? C.white : C.tableAlt },
          margins: { top: 40, bottom: 40, left: 100, right: 100 },
          children: [new Paragraph({
            spacing: { line: 276 },
            children: [new TextRun({ text: content, font: FONT, size: 20, bold: bold_, color: color_ })],
          })],
          width: { size: colWidth, type: WidthType.DXA },
        });
      }),
    })
  );

  return new Table({
    width: { size: 9000, type: WidthType.DXA },
    rows: [headerRow, ...dataRows],
  });
}

// === COVER PAGE ===
function buildCover() {
  return [
    emptyLine(), emptyLine(), emptyLine(), emptyLine(), emptyLine(), emptyLine(),
    emptyLine(), emptyLine(), emptyLine(), emptyLine(),
    new Paragraph({
      spacing: { after: 100 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "STANDAR OPERASIONAL PROSEDUR", font: FONT, size: 22, color: C.secondary, bold: true })],
    }),
    new Paragraph({
      spacing: { after: 60 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "\u2500".repeat(50), font: FONT, size: 20, color: C.secondary })],
    }),
    new Paragraph({
      spacing: { after: 200 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "PUSHAKIN FLOWS", font: FONT, size: 52, bold: true, color: C.primary })],
    }),
    new Paragraph({
      spacing: { after: 80 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "Sistem Manajemen Produksi Kehumasan", font: FONT, size: 28, color: C.secondary })],
    }),
    new Paragraph({
      spacing: { after: 200 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "Pusat Hubungan Masyarakat dan Keterbukaan Informasi", font: FONT, size: 24, color: C.textLight })],
    }),
    new Paragraph({
      spacing: { after: 60 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "\u2500".repeat(50), font: FONT, size: 20, color: C.secondary })],
    }),
    emptyLine(), emptyLine(),
    new Paragraph({
      spacing: { after: 60 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "Versi 1.0", font: FONT, size: 22, bold: true, color: C.primary })],
    }),
    new Paragraph({
      spacing: { after: 60 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Tahun ${new Date().getFullYear()}`, font: FONT, size: 22, color: C.textLight })],
    }),
    new Paragraph({
      spacing: { before: 600, after: 60 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "Dokumen ini bersifat RAHASIA dan hanya untuk pengguna internal.", font: FONT, size: 18, italics: true, color: C.textMuted })],
    }),
  ];
}

// === BODY CONTENT ===
function buildContent() {
  const content = [];

  // BAB I - PENDAHULUAN
  content.push(heading("BAB I  PENDAHULUAN"));
  
  content.push(heading("1.1  Latar Belakang", HeadingLevel.HEADING_2));
  content.push(para("Pushakin Flows adalah aplikasi berbasis web yang dirancang untuk mengelola alur kerja produksi kehumasan di lingkungan Pusat Hubungan Masyarakat dan Keterbukaan Informasi. Aplikasi ini memudahkan koordinasi antar tim mulai dari penerimaan permohonan hingga publikasi hasil produksi secara terstruktur dan terukur."));
  
  content.push(heading("1.2  Tujuan SOP", HeadingLevel.HEADING_2));
  content.push(para("Standar Operasional Prosedur (SOP) ini disusun sebagai acuan bagi seluruh pengguna aplikasi Pushakin Flows agar:"));
  content.push(...bullet([
    "Setiap pengguna memahami peran dan tanggung jawabnya masing-masing.",
    "Alur kerja produksi kehumasan berjalan secara konsisten dan terstruktur.",
    "Proses pengelolaan surat, proyek, dan dokumen berjalan sesuai prosedur yang telah ditetapkan.",
    "Menghindari kesalahan operasional yang dapat menghambat proses produksi.",
    "Memastikan keamanan dan kerahasiaan data sistem.",
  ]));

  content.push(heading("1.3  Ruang Lingkup", HeadingLevel.HEADING_2));
  content.push(para("SOP ini mencakup seluruh fitur dan prosedur operasional dalam aplikasi Pushakin Flows, meliputi pengelolaan surat, pembuatan proyek, alokasi tugas, manajemen file, pelaporan, serta pengaturan akun dan keamanan sistem."));

  content.push(heading("1.4  Akses Aplikasi", HeadingLevel.HEADING_2));
  content.push(para("Aplikasi Pushakin Flows diakses melalui browser web pada alamat yang disediakan oleh administrator sistem. Setiap pengguna akan diberikan akun login berupa alamat email dan password default."));
  content.push(...numberedItem(1, [
    "Buka alamat aplikasi di browser web (Chrome, Firefox, Edge, atau Safari).",
    "Masukkan email dan password yang telah diberikan.",
    "Jika menggunakan password default, sistem akan meminta Anda untuk membuat password baru.",
    "Password baru wajib: minimal 8 karakter, kombinasi huruf dan angka.",
    "Setelah berhasil login, Anda akan diarahkan ke halaman Dashboard.",
  ]));

  // BAB II - PERAN & HAK AKSES
  content.push(heading("BAB II  PERAN DAN HAK AKSES"));

  content.push(heading("2.1  Daftar Peran Pengguna", HeadingLevel.HEADING_2));
  content.push(para("Berikut adalah seluruh peran yang tersedia dalam sistem Pushakin Flows beserta tahapan kerjanya:"));

  content.push(makeTable(
    ["No", "Peran", "Tahapan", "Tipe Tugas"],
    [
      ["1", "Administrator", "\u2014", "Pengelolaan Surat"],
      ["2", "Manager", "Tahap 0 (Perencanaan)", "Manajemen Proyek"],
      ["3", "Reporter", "Tahap 1 (Produksi)", "Upload File"],
      ["4", "Photographer, Videographer, dan Audio", "Tahap 1 (Produksi)", "Upload File"],
      ["5", "Graphic Designer", "Tahap 1 (Produksi)", "Upload File"],
      ["6", "Editor (Video)", "Tahap 2 (Pasca Produksi)", "Download & Upload"],
      ["7", "Editor (Web Article/Author)", "Tahap 2 (Pasca Produksi)", "Download & Upload"],
      ["8", "Editor (Foto)", "Tahap 2 (Pasca Produksi)", "Download & Upload"],
      ["9", "Streaming Operator", "Tahap 2 (Pasca Produksi)", "Tempel Link Streaming"],
      ["10", "Podcast Operator", "Tahap 2 (Pasca Produksi)", "Tempel Link YouTube"],
      ["11", "Editor (Template Sosial Media)", "Tahap 4 (Finalization)", "Download & Upload"],
      ["12", "Reviewer", "Tahap 3 (Review)", "Review Konten"],
      ["13", "Publisher Web", "Tahap 5 (Publikasi)", "Download & Tambah Link"],
      ["14", "Publisher Social Media", "Tahap 5 (Publikasi)", "Download & Tambah Link"],
      ["15", "Super Admin", "Semua Tahapan", "Pengelolaan Sistem"],
    ]
  ));

  content.push(heading("2.2  Hak Akses Menu per Peran", HeadingLevel.HEADING_2));
  content.push(para("Setiap peran memiliki akses menu navigasi yang berbeda sesuai fungsinya:"));

  content.push(makeTable(
    ["Menu Navigasi", "Super Admin", "Administrator", "Manager", "Staff"],
    [
      ["Dashboard", "\u2713", "\u2713", "\u2713", "\u2713"],
      ["Statistik & Progress", "\u2713", "\u2713", "\u2713", "\u2713"],
      ["Manajemen Surat", "\u2713", "\u2713", "\u2717", "\u2717"],
      ["Program Kegiatan", "\u2713", "\u2717", "\u2713", "\u2717"],
      ["Inbox", "\u2713", "\u2713", "\u2713", "\u2713"],
      ["Manajemen Konten", "\u2713", "\u2717", "\u2717", "\u2717"],
      ["Laporan Kegiatan", "\u2713", "\u2717", "\u2713", "\u2717"],
      ["Profil Saya", "\u2713", "\u2713", "\u2713", "\u2713"],
      ["Manajemen User", "\u2713", "\u2717", "\u2717", "\u2717"],
      ["Pengaturan", "\u2713", "\u2717", "\u2717", "\u2717"],
    ]
  ));

  // BAB III - ALUR KERJA
  content.push(heading("BAB III  ALUR KERJA UMUM"));

  content.push(heading("3.1  Gambaran Umum Alur Produksi", HeadingLevel.HEADING_2));
  content.push(para("Alur kerja produksi kehumasan dalam Pushakin Flows terdiri dari 7 tahapan yang berurutan. Setiap tahapan harus diselesaikan sebelum tahapan berikutnya dimulai."));

  content.push(makeTable(
    ["Tahap", "Nama Tahap", "Penanggung Jawab", "Keterangan"],
    [
      ["0", "Perencanaan", "Manager", "Pembuatan proyek, alokasi tugas dan folder"],
      ["1", "Produksi", "Reporter, Fotografer, Videografer, Desainer", "Pengumpulan materi mentah (teks, foto, video, desain)"],
      ["2", "Pasca Produksi", "Editor, Streaming Op., Podcast Op.", "Pengeditan video, artikel, foto; pascaproduksi konten"],
      ["3", "Review", "Reviewer", "Quality control dan persetujuan konten hasil Pasca Produksi"],
      ["4", "Finalization", "Editor (Template Sosial Media)", "Pembuatan template konten media sosial dari foto yang telah direview"],
      ["5", "Publikasi", "Publisher Web, Publisher Sosmed", "Publikasi ke berbagai platform media"],
      ["6", "Selesai", "\u2014", "Proyek ditandai selesai secara otomatis"],
    ]
  ));

  content.push(heading("3.2  Peralihan Tahap Otomatis", HeadingLevel.HEADING_2));
  content.push(para("Sistem akan secara otomatis memindahkan proyek ke tahap berikutnya ketika seluruh tugas pada tahap saat ini telah ditandai selesai oleh penanggung jawabnya. Pengecualian: pada Tahap 3 (Review), jika Reviewer menolak konten, proyek akan dikembalikan ke Tahap 2 (Pasca Produksi) dan seluruh tugas pada Tahap 2, 3, dan 4 akan direset ke status pending."));

  // BAB IV - PROSEDUR ADMINISTRATOR
  content.push(heading("BAB IV  PROSEDUR ADMINISTRATOR"));

  content.push(heading("4.1  Mengelola Surat Masuk", HeadingLevel.HEADING_2));
  content.push(heading("4.1.1  Membuat Surat Masuk Baru", HeadingLevel.HEADING_3));
  content.push(para("Administrator bertanggung jawab atas pengelolaan seluruh surat yang masuk ke bagian kehumasan. Berikut langkah-langkah pembuatan surat masuk:"));
  content.push(...numberedItem(1, [
    "Buka menu Manajemen Surat di sidebar navigasi.",
    "Klik tombol \u201c+ Buat Surat Baru\u201d.",
    "Isi form surat dengan data berikut:",
  ]));
  content.push(...bullet([
    "Nomor Surat (wajib diisi)",
    "Jenis Surat: Surat Masuk / Surat Keluar",
    "Kategori: Permohonan / Undangan / Pemberitaan / Laporan / Surat Keputusan / Lainnya",
    "Tanggal Surat",
    "Pengirim dan Penerima",
    "Perihal dan Deskripsi",
  ], 1));
  content.push(...numberedItem(4, [
    "Jika kategori Permohonan, isi tambahan: Lokasi, Waktu Pelaksanaan, Nama PIC, No. WhatsApp PIC.",
    "Upload lampiran surat (file fisik dalam format PDF/gambar).",
    "Klik Simpan. Status surat akan menjadi \u201cDiterima\u201d.",
  ]));

  content.push(heading("4.1.2  Meneruskan Surat ke Manager", HeadingLevel.HEADING_3));
  content.push(...numberedItem(1, [
    "Buka surat yang akan diteruskan.",
    "Klik tombol Forward (ikon kirim).",
    "Pilih Manager yang dituju dari dropdown.",
    "Klik Konfirmasi. Status surat berubah menjadi \u201cDiteruskan\u201d.",
    "Manager akan menerima notifikasi di Inbox.",
  ]));

  content.push(heading("4.1.3  Memantau Status Surat", HeadingLevel.HEADING_3));
  content.push(para("Administrator dapat memantau status surat melalui menu Manajemen Surat. Filter surat berdasarkan status: Diterima, Diproses, Diteruskan, Selesai, Ditolak, atau Arsip."));

  // BAB V - PROSEDUR MANAGER
  content.push(heading("BAB V  PROSEDUR MANAGER"));

  content.push(heading("5.1  Menerima dan Menindaklanjuti Permohonan", HeadingLevel.HEADING_2));
  content.push(...numberedItem(1, [
    "Buka menu Inbox untuk melihat surat/permohonan yang diteruskan oleh Administrator.",
    "Baca detail permohonan, pastikan seluruh informasi sudah lengkap.",
    "Jika informasi kurang lengkap, hubungi Administrator untuk klarifikasi.",
    "Klik tombol Terima untuk membuat proyek baru dari permohonan tersebut.",
  ]));

  content.push(heading("5.2  Membuat Proyek Baru", HeadingLevel.HEADING_2));
  content.push(para("Setelah menerima permohonan, Manager membuat proyek dengan langkah berikut:"));
  content.push(...numberedItem(1, [
    "Formulir proyek akan terisi otomatis dari data permohonan/surat. Periksa dan lengkapi jika diperlukan.",
    "Isi Judul Proyek secara deskriptif (contoh: \u201cPeliputan Kunjungan Kerja Kepala BPS ke Pemkab\u201d).",
    "Verifikasi data: Unit Pemohon, Lokasi, Waktu Pelaksanaan, Nama PIC, No. WhatsApp PIC.",
    "Pilih Jenis Kegiatan: Peliputan / Pemberitaan / Live Streaming / Podcast / Desain / Lainnya.",
    "Pilih Kebutuhan Output: Teks / Foto / Video / Audio / Streaming / Desain / Podcast / Lainnya.",
    "Tulis Detail & Instruksi Permohonan yang jelas bagi seluruh tim.",
  ]));
  content.push(heading("5.2.1  Alokasi Tim", HeadingLevel.HEADING_3));
  content.push(para("Manager wajib mengalokasikan minimal satu anggota tim untuk setiap peran yang dibutuhkan:"));
  content.push(...bullet([
    "Tahap 1 (Produksi): Pilih Reporter, Fotografer, Videografer, dan/atau Desainer.",
    "Tahap 2 (Pasca Produksi): Pilih Editor Media, Editor Web & Sosmed, Streaming Op., dan/atau Podcast Op.",
    "Tahap 3 (Review): Pilih Reviewer.",
    "Tahap 4 (Finalization): Pilih Editor (Template Sosial Media).",
    "Tahap 5 (Publikasi): Pilih Publisher Web dan/atau Publisher Social Media.",
    "Pastikan setiap peran hanya diisi oleh satu anggota tim.",
  ]));
  content.push(heading("5.2.2  Konfigurasi Workspace Drive", HeadingLevel.HEADING_3));
  content.push(para("Manager mengatur folder kerja untuk setiap proyek:"));
  content.push(...numberedItem(1, [
    "Pilih folder yang diperlukan (default: PRODUKSI, PASCA PRODUKSI, FINAL PRODUCT).",
    "Tentukan hak akses Download (DL) dan Upload (UL) untuk setiap anggota tim per folder.",
    "Anggota tim yang mendapat akses Upload akan otomatis dibuatkan subfolder pribadi.",
    "Klik Simpan untuk membuat proyek. Sistem otomatis membuat folder di Google Drive dan mengirim Surat Tugas ke seluruh tim.",
  ]));

  content.push(heading("5.3  Memantau Progres Proyek", HeadingLevel.HEADING_2));
  content.push(...numberedItem(1, [
    "Buka halaman Dashboard untuk melihat daftar proyek beserta progresnya.",
    "Klik proyek untuk melihat detail: status setiap tahap, progres anggota tim, dan file yang diunggah.",
    "Gunakan menu Statistik & Progress untuk melihat statistik keseluruhan.",
    "Jika diperlukan, Manager dapat mengedit link folder melalui tombol Koreksi Folder.",
  ]));

  content.push(heading("5.4  Mengekspor Laporan", HeadingLevel.HEADING_2));
  content.push(para("Manager dapat mengekspor laporan kegiatan yang telah selesai (Tahap 5):"));
  content.push(...numberedItem(1, [
    "Buka menu Laporan Kegiatan.",
    "Filter berdasarkan user atau tampilkan semua.",
    "Klik tombol Export Excel untuk mengunduh dalam format spreadsheet.",
    "Klik tombol Cetak PDF untuk mengunduh dalam format dokumen PDF.",
    "Laporan mencakup: informasi proyek, tim, status tugas, tautan hasil produksi, dan lampiran surat.",
  ]));

  // BAB VI - PROSEDUR STAFF / TIM PRODUKSI
  content.push(heading("BAB VI  PROSEDUR TIM PRODUKSI"));

  content.push(heading("6.1  Melihat Tugas yang Diberikan", HeadingLevel.HEADING_2));
  content.push(...numberedItem(1, [
    "Setelah login, buka halaman Dashboard.",
    "Proyek yang Anda terlibat akan ditampilkan beserta statusnya.",
    "Klik proyek untuk melihat detail tugas Anda.",
    "Tugas Anda ditampilkan di bagian bawah halaman proyek dengan label \u201cTugas Anda\u201d.",
  ]));

  content.push(heading("6.2  Mengupload File Hasil Kerja", HeadingLevel.HEADING_2));
  content.push(para("PENTING: Upload file harus dilakukan melalui section \u201cTugas Anda\u201d pada halaman detail proyek, BUKAN langsung melalui Google Drive. Hal ini agar alur kerja terekam dengan benar dalam sistem."));
  content.push(...numberedItem(1, [
    "Buka Dashboard dan klik proyek yang sedang dikerjakan.",
    "Scroll ke bagian bawah, temukan section \u201cTugas Anda\u201d.",
    "Di dalam card tugas, Anda akan melihat folder tujuan upload beserta tombol upload.",
    "Klik area upload atau drag-and-drop file ke area yang disediakan.",
    "Tunggu proses upload selesai. File akan tersimpan di Google Drive dan tercatat dalam sistem.",
    "Jika tugas sudah selesai, centang tugas sebagai Selesai.",
  ]));
  content.push(para([
    new TextRun({ text: "Catatan: ", font: FONT, size: 22, bold: true, color: C.accent }),
    new TextRun({ text: "Subfolder di bagian Workspace Drive bersifat informasi saja dan tidak dapat digunakan untuk upload langsung. Ikuti alur yang benar melalui Tugas Anda.", font: FONT, size: 22, color: C.text }),
  ]));

  content.push(heading("6.3  Menyelesaikan Tugas", HeadingLevel.HEADING_2));
  content.push(para("Setiap anggota tim wajib menyelesaikan tugasnya agar proyek dapat berpindah ke tahap berikutnya:"));
  content.push(...bullet([
    "Reporter, Fotografer, Videografer, Desainer (Tahap 1): Upload materi mentah, tambahkan tautan hasil kerja jika ada, lalu centang Selesai.",
    "Editor (Tahap 2): Download materi dari folder PRODUKSI, edit konten, upload hasil ke folder PASCA PRODUKSI, centang Selesai.",
    "Streaming Operator (Tahap 2): Tempel link streaming hasil siaran, centang Selesai.",
    "Podcast Operator (Tahap 2): Tempel link YouTube podcast, centang Selesai.",
    "Reviewer (Tahap 3): Periksa seluruh konten hasil Pasca Produksi. Jika layak, klik Setujui untuk meneruskan ke Finalization. Jika perlu perbaikan, klik Tolak dengan alasan.",
    "Editor Template Sosial Media (Tahap 4): Download foto yang sudah direview dari folder PASCA PRODUKSI, buat template media sosial, upload hasilnya, centang Selesai.",
    "Publisher Web (Tahap 5): Download dari FINAL PRODUCT, publikasikan ke Website, tambahkan tautan, centang Selesai.",
    "Publisher Social Media (Tahap 5): Download dari FINAL PRODUCT, publikasikan ke media sosial, tambahkan tautan, centang Selesai.",
  ]));

  content.push(heading("6.4  Membaca Surat Tugas", HeadingLevel.HEADING_2));
  content.push(...numberedItem(1, [
    "Buka menu Inbox di sidebar navigasi.",
    "Jumlah surat tugas yang belum dibaca ditandai dengan badge merah.",
    "Klik surat tugas untuk melihat detailnya.",
    "Surat tugas berisi informasi proyek, peran Anda, dan instruksi dari Manager.",
    "Anda juga dapat mengunduh Surat Tugas dalam format PDF.",
  ]));

  // BAB VII - WORKSPACE DRIVE
  content.push(heading("BAB VII  WORKSPACE DRIVE"));

  content.push(heading("7.1  Struktur Folder", HeadingLevel.HEADING_2));
  content.push(para("Setiap proyek memiliki Workspace Drive yang terdiri dari beberapa folder kerja di Google Drive:"));

  content.push(makeTable(
    ["No", "Folder", "Fungsi", "Pengguna Utama"],
    [
      ["1", "PRODUKSI (Berkas Mentah)", "Upload materi mentah: teks, foto mentah, video mentah, file desain", "Reporter, Fotografer, Videografer, Desainer"],
      ["2", "PASCA PRODUKSI (Draft & Editing)", "Upload hasil edit dan draft konten", "Editor, Reviewer, Publisher"],
      ["3", "FINAL PRODUCT (Siap Publish)", "File hasil akhir yang siap dipublikasikan", "Publisher Web, Publisher Sosmed"],
      ["4", "DESAIN FOLDER (Aset Visual)", "Penyimpanan file project desain", "Graphic Designer"],
      ["5", "LAINNYA (Folder Tambahan)", "Folder kustom untuk kebutuhan logistik", "Sesuai kebutuhan"],
    ]
  ));

  content.push(heading("7.2  Aturan Upload File", HeadingLevel.HEADING_2));
  content.push(...bullet([
    "Upload file WAJIB dilakukan melalui section \u201cTugas Anda\u201d di halaman detail proyek.",
    "JANGAN upload langsung melalui link Google Drive di bagian Workspace Drive.",
    "Setiap anggota tim memiliki subfolder pribadi yang dibuatkan secara otomatis oleh sistem.",
    "Pastikan file yang diupload sesuai dengan folder tujuan yang ditentukan.",
    "Gunakan nama file yang deskriptif (contoh: Foto_Kunker_BPS_01.jpg).",
  ]));

  // BAB VIII - LAPORAN & REKAPITULASI
  content.push(heading("BAB VIII  LAPORAN DAN REKAPITULASI"));

  content.push(heading("8.1  Laporan Kegiatan", HeadingLevel.HEADING_2));
  content.push(para("Menu Laporan Kegiatan menampilkan seluruh proyek yang telah selesai (Tahap 5). Fitur ini hanya dapat diakses oleh Manager dan Super Admin."));
  content.push(para("Informasi yang tercatat dalam laporan meliputi:"));
  content.push(...bullet([
    "Informasi Proyek: judul, unit pemohon, lokasi, waktu, PIC.",
    "Tim Kerja: nama setiap anggota per tahap beserta status penyelesaian.",
    "Hasil Produksi: tautan ke platform publikasi (Website, Instagram, Facebook, YouTube, dll).",
    "Lampiran Surat: dokumen pendukung dari surat permohonan asli.",
    "Catatan: catatan tambahan dari setiap anggota tim.",
  ]));

  content.push(heading("8.2  Format Ekspor", HeadingLevel.HEADING_2));
  content.push(makeTable(
    ["Format", "Kegunaan", "Cara Akses"],
    [
      ["Excel (.xlsx)", "Analisis data, rekap tabular, filtering", "Klik \u201cExport Excel\u201d di halaman Laporan"],
      ["PDF", "Dokumen cetak, arsip, distribusi", "Klik \u201cCetak PDF\u201d di halaman Laporan"],
    ]
  ));

  // BAB IX - PUBLIC TRACKER
  content.push(heading("BAB IX  STATISTIK & PROGRESS PUBLIK"));

  content.push(heading("9.1  Fitur Public Tracker", HeadingLevel.HEADING_2));
  content.push(para("Public Tracker adalah tampilan monitor layar penuh yang menampilkan progres seluruh proyek secara real-time. Fitur ini dapat diakses oleh siapa saja melalui tautan publik tanpa perlu login."));
  content.push(para("Fitur yang tersedia:"));
  content.push(...bullet([
    "Tampilan grid yang dapat disesuaikan (1x1 hingga 4x4).",
    "Filter berdasarkan waktu: Semua, Hari Ini, Minggu Ini, Bulan Ini, Tahun Ini.",
    "Auto-refresh setiap 30 menit dan auto-paginasi setiap 8 detik.",
    "Statistik ringkas: Total Proyek, Sedang Berjalan, Telah Selesai.",
    "Jam digital real-time.",
  ]));

  content.push(heading("9.2  Cara Membagikan ke Publik", HeadingLevel.HEADING_2));
  content.push(...numberedItem(1, [
    "Buka menu Statistik & Progress.",
    "Klik tombol \u201cBagikan ke Publik\u201d (hijau, dengan ikon share).",
    "Tautan akan otomatis disalin ke clipboard.",
    "Bagikan tautan tersebut untuk ditampilkan pada monitor kantor atau layar publik.",
  ]));

  // BAB X - KEAMANAN
  content.push(heading("BAB X  KEAMANAN DAN PENGELOLAAN AKUN"));

  content.push(heading("10.1  Kebijakan Password", HeadingLevel.HEADING_2));
  content.push(para("Untuk menjaga keamanan akun, berlaku ketentuan berikut:"));
  content.push(makeTable(
    ["Ketentuan", "Keterangan"],
    [
      ["Panjang minimal", "8 karakter"],
      ["Kombinasi", "Wajib mengandung huruf dan angka"],
      ["Password default", "Akan diminta diganti saat login pertama kali"],
      ["Perubahan", "Dapat diubah kapan saja melalui menu Profil Saya"],
    ]
  ));

  content.push(heading("10.2  Best Practices Keamanan", HeadingLevel.HEADING_2));
  content.push(...bullet([
    "Jangan membagikan password kepada siapa pun, termasuk sesama anggota tim.",
    "Gunakan password yang unik dan tidak mudah ditebak.",
    "Selalu klik Logout setelah selesai menggunakan aplikasi.",
    "Hindari menggunakan perangkat publik untuk mengakses aplikasi.",
    "Jika mencurigai akun diretas, segera hubungi Super Admin.",
  ]));

  content.push(heading("10.3  Ganti Password", HeadingLevel.HEADING_2));
  content.push(...numberedItem(1, [
    "Buka menu Profil Saya di sidebar.",
    "Scroll ke bagian \u201cKeamanan Akun\u201d.",
    "Masukkan password saat ini.",
    "Buat password baru (minimal 8 karakter, kombinasi huruf dan angka).",
    "Konfirmasi password baru.",
    "Klik \u201cSimpan Password Baru\u201d.",
  ]));

  // BAB XI - SUPER ADMIN
  content.push(heading("BAB XI  PROSEDUR KHUSUS SUPER ADMIN"));

  content.push(heading("11.1  Manajemen User", HeadingLevel.HEADING_2));
  content.push(para("Super Admin memiliki akses penuh untuk mengelola seluruh pengguna sistem:"));
  content.push(...numberedItem(1, [
    "Buka menu Manajemen User.",
    "Untuk menambah user baru: klik \u201c+ Tambah User\u201d, isi nama, email, dan pilih peran.",
    "Untuk mengedit user: klik tombol edit pada baris user yang bersangkutan.",
    "Untuk menghapus user: klik tombol hapus (hati-hati, tindakan ini tidak dapat dibatalkan).",
  ]));

  content.push(heading("11.2  Impersonasi User", HeadingLevel.HEADING_2));
  content.push(para("Super Admin dapat mengimpersonasi (login sebagai) user lain untuk membantu troubleshooting atau monitoring:"));
  content.push(...numberedItem(1, [
    "Buka menu Manajemen User.",
    "Klik tombol \u201cLogin Sebagai\u201d pada user yang dituju.",
    "Sidebar akan berubah warna menjadi amber sebagai penanda mode impersonasi.",
    "Tampilan dan menu akan menyesuaikan dengan peran user yang di-impersonasi.",
    "Klik \u201cKembali ke Super Admin\u201d untuk keluar dari mode impersonasi.",
  ]));
  content.push(para([
    new TextRun({ text: "Catatan: ", font: FONT, size: 22, bold: true, color: C.accent }),
    new TextRun({ text: "Menu Manajemen User dan Pengaturan tidak akan ditampilkan saat impersonasi.", font: FONT, size: 22, color: C.text }),
  ]));

  content.push(heading("11.3  Pengaturan Sistem", HeadingLevel.HEADING_2));
  content.push(para("Melalui menu Pengaturan, Super Admin dapat mengkonfigurasi:"));
  content.push(...bullet([
    "Integrasi Google Drive: upload Service Account Key, atur Shared Drive ID, test koneksi.",
    "Auto-create folder: aktifkan/nonaktifkan pembuatan folder otomatis saat proyek dibuat.",
    "Mode Maintenance: aktifkan untuk memblokir akses sementara bagi seluruh user non-Admin.",
    "Manajemen Konten: kelola pengumuman, SOP, dan panduan yang ditampilkan ke seluruh pengguna.",
  ]));

  // BAB XII - PENUTUP
  content.push(heading("BAB XII  PENUTUP"));

  content.push(heading("12.1  Kontak & Bantuan", HeadingLevel.HEADING_2));
  content.push(para("Jika mengalami kendala teknis atau memerlukan bantuan terkait penggunaan aplikasi Pushakin Flows, silakan hubungi Super Admin atau tim pengembang melalui mekanisme yang telah ditentukan oleh instansi."));

  content.push(heading("12.2  Pembaruan Dokumen", HeadingLevel.HEADING_2));
  content.push(para("Dokumen SOP ini akan diperbarui secara berkala sesuai dengan perkembangan fitur aplikasi. Setiap pembaruan akan diberitahukan melalui fitur Manajemen Konten di aplikasi. Pengguna wajib membaca dan memahami setiap pembaruan yang berlaku."));

  content.push(heading("12.3  Riwayat Revisi", HeadingLevel.HEADING_2));
  content.push(makeTable(
    ["Versi", "Tanggal", "Perubahan", "Oleh"],
    [
      ["1.0", new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" }), "Dokumen SOP awal", "Tim Pengembang"],
    ]
  ));

  return content;
}

// === ASSEMBLE DOCUMENT ===
async function main() {
  const doc = new Document({
    creator: "Pushakin Flows",
    title: "SOP Pushakin Flows - Standar Operasional Prosedur",
    description: "Standar Operasional Prosedur Sistem Manajemen Produksi Kehumasan",
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 22, color: C.text },
          paragraph: { spacing: { line: 312 } },
        },
        heading1: {
          run: { font: FONT, size: 28, bold: true, color: C.primary },
          paragraph: { spacing: { before: 360, after: 120, line: 312 } },
        },
        heading2: {
          run: { font: FONT, size: 24, bold: true, color: C.secondary },
          paragraph: { spacing: { before: 240, after: 120, line: 312 } },
        },
        heading3: {
          run: { font: FONT, size: 22, bold: true, color: C.text },
          paragraph: { spacing: { before: 180, after: 100, line: 312 } },
        },
      },
    },
    sections: [
      // SECTION 1: Cover
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          },
        },
        children: buildCover(),
      },
      // SECTION 2: TOC
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          },
        },
        headers: {
          default: new Header({
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: "SOP Pushakin Flows", font: FONT, size: 18, color: C.textMuted, italics: true })],
            })],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: "Halaman ", font: FONT, size: 18, color: C.textMuted }),
                new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: C.textMuted }),
              ],
            })],
          }),
        },
        children: [
          new Paragraph({
            spacing: { after: 200 },
            children: [new TextRun({ text: "DAFTAR ISI", font: FONT, size: 28, bold: true, color: C.primary })],
          }),
          new TableOfContents("Daftar Isi", {
            hyperlink: true,
            headingStyleRange: "1-3",
          }),
          new Paragraph({
            children: [new PageBreak()],
          }),
          ...buildContent(),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync("/home/z/my-project/SOP_Pushakin_Flows.docx", buffer);
  console.log("SOP document generated: /home/z/my-project/SOP_Pushakin_Flows.docx");
}

main().catch(console.error);
