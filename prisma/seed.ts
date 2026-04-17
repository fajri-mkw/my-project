import { db } from '../src/lib/db'

async function seed() {
  console.log('🌱 Seeding Pushakin Flows...')

  // ── Create Users ──
  const manager = await db.user.upsert({
    where: { email: 'manager@pushakin.id' },
    update: {},
    create: { email: 'manager@pushakin.id', name: 'Budi Santoso', role: 'MANAGER' },
  })

  const reporter = await db.user.upsert({
    where: { email: 'reporter@pushakin.id' },
    update: {},
    create: { email: 'reporter@pushakin.id', name: 'Rina Wati', role: 'REPORTER' },
  })

  const fotografer = await db.user.upsert({
    where: { email: 'fotografer@pushakin.id' },
    update: {},
    create: { email: 'fotografer@pushakin.id', name: 'Andi Pratama', role: 'FOTOGRAFER' },
  })

  const editor = await db.user.upsert({
    where: { email: 'editor@pushakin.id' },
    update: {},
    create: { email: 'editor@pushakin.id', name: 'Siti Nurhaliza', role: 'EDITOR' },
  })

  const publisherWeb = await db.user.upsert({
    where: { email: 'publisher.web@pushakin.id' },
    update: {},
    create: { email: 'publisher.web@pushakin.id', name: 'Dewi Lestari', role: 'PUBLISHER_WEB' },
  })

  const publisherSocial = await db.user.upsert({
    where: { email: 'publisher.social@pushakin.id' },
    update: {},
    create: { email: 'publisher.social@pushakin.id', name: 'Raka Putra', role: 'PUBLISHER_SOCIAL_MEDIA' },
  })

  // ── Create Sample Normal-flow Permohonan ──
  const normalPermohonan = await db.permohonan.create({
    data: {
      judul: 'Kunjungan Kerja Gubernur ke Kabupaten Bone',
      deskripsi: 'Peliputan kunjungan kerja Gubernur Sulawesi Selatan dalam rangka monitoring pembangunan infrastruktur.',
      fastTrack: false,
      status: 'IN_PROGRESS',
      managerId: manager.id,
      reporterId: reporter.id,
      reporterStatus: 'COMPLETED',
      reporterCompletedAt: new Date(),
      kontenBerita: 'Gubernur Sulawesi Selatan melakukan kunjungan kerja ke Kabupaten Bone untuk memantau progres pembangunan jalan tol baru...',
      fotograferId: fotografer.id,
      fotograferStatus: 'IN_PROGRESS',
      editorId: editor.id,
      editorStatus: 'PENDING',
      publisherWebId: publisherWeb.id,
      publisherWebStatus: 'PENDING',
      publisherSocialId: publisherSocial.id,
      publisherSocialStatus: 'PENDING',
    },
  })

  // ── Create Sample Fast-track Permohonan (completed) ──
  const fastTrackCompleted = await db.permohonan.create({
    data: {
      judul: 'Pengumuman Libur Nasional Hari Pendidikan Nasional',
      deskripsi: 'Pengumuman resmi libur nasional dalam rangka memperingati Hardiknas.',
      fastTrack: true,
      status: 'COMPLETED',
      managerId: manager.id,
      reporterId: null,
      reporterStatus: 'SKIPPED',
      fotograferId: null,
      fotograferStatus: 'SKIPPED',
      editorId: null,
      editorStatus: 'SKIPPED',
      publisherWebId: publisherWeb.id,
      publisherWebStatus: 'COMPLETED',
      publisherWebCompletedAt: new Date(),
      linkPublikasiWeb: 'https://pushakin.id/berita/libur-hardiknas-2025',
      publisherSocialId: publisherSocial.id,
      publisherSocialStatus: 'COMPLETED',
      publisherSocialCompletedAt: new Date(),
      linkPublikasiSocial: 'https://instagram.com/pushakin/C9xample',
    },
  })

  // Create rekapitulasi for the completed one
  await db.rekapitulasi.create({
    data: {
      permohonanId: fastTrackCompleted.id,
      judul: fastTrackCompleted.judul,
      isFastTrack: true,
      tanggalSelesai: new Date(),
      linkWeb: fastTrackCompleted.linkPublikasiWeb,
      linkSocial: fastTrackCompleted.linkPublikasiSocial,
      namaPublisherWeb: publisherWeb.name,
      namaPublisherSocial: publisherSocial.name,
    },
  })

  console.log('✅ Seed completed!')
  console.log(`   Users: 6`)
  console.log(`   Normal permohonan: ${normalPermohonan.id}`)
  console.log(`   Fast-track permohonan (completed): ${fastTrackCompleted.id}`)
}

seed()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
