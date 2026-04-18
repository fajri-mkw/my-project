const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database with restored data...');
  
  // Load data from JSON files
  const users = JSON.parse(fs.readFileSync('/tmp/vercel-users.json', 'utf8'));
  const projects = JSON.parse(fs.readFileSync('/tmp/vercel-projects.json', 'utf8'));
  const suratList = JSON.parse(fs.readFileSync('/tmp/vercel-surat.json', 'utf8'));
  
  // 1. Seed Users
  console.log(`Creating ${users.length} users...`);
  for (const u of users) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: {},
      create: {
        id: u.id,
        name: u.name,
        email: u.email,
        password: '$2a$10$placeholder',
        whatsapp: u.whatsapp || null,
        avatar: u.avatar || null,
        role: u.role,
      }
    });
  }
  console.log(`✅ Created ${users.length} users`);
  
  // 2. Seed Projects + Tasks + Drive Folders
  console.log(`Creating ${projects.length} projects...`);
  for (const p of projects) {
    // Create project
    await prisma.project.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id,
        title: p.title,
        description: p.description,
        requesterUnit: p.requesterUnit,
        location: p.location || null,
        executionTime: p.executionTime || null,
        picName: p.picName || null,
        picWhatsApp: p.picWhatsApp || null,
        activityTypes: JSON.stringify(p.activityTypes || []),
        customActivity: p.customActivity || null,
        outputNeeds: JSON.stringify(p.outputNeeds || []),
        customOutput: p.customOutput || null,
        currentStage: p.currentStage,
        isFastTrack: p.isFastTrack || false,
        managerId: p.managerId,
        documents: JSON.stringify(p.documents || []),
        createdAt: new Date(p.createdAt),
      }
    });
    
    // Create tasks
    for (const t of p.tasks || []) {
      await prisma.task.upsert({
        where: { id: t.id },
        update: {},
        create: {
          id: t.id,
          role: t.role,
          stage: t.stage,
          status: t.status,
          assignedTo: t.assignedTo,
          projectId: p.id,
          data: JSON.stringify(t.data || {}),
        }
      });
    }
    
    // Create drive folders
    for (const f of p.driveFolders || []) {
      await prisma.driveFolder.upsert({
        where: { id: f.id },
        update: {},
        create: {
          id: f.id,
          folderId: f.folderId,
          name: f.name,
          description: f.desc || null,
          link: f.link || null,
          assignedRoles: JSON.stringify(f.assignedRoles || []),
          assignedUsers: JSON.stringify(f.assignedUsers || []),
          color: f.color || null,
          bgColor: f.bg || null,
          borderColor: f.border || null,
          projectId: p.id,
          parentFolderId: f.parentFolderId || null,
        }
      });
    }
    
    console.log(`  ✅ Project: ${p.title} (${p.tasks?.length || 0} tasks, ${p.driveFolders?.length || 0} folders)`);
  }
  
  // 3. Seed Surat
  console.log(`Creating ${suratList.length} surat...`);
  for (const s of suratList) {
    await prisma.surat.upsert({
      where: { id: s.id },
      update: {},
      create: {
        id: s.id,
        nomorSurat: s.nomorSurat,
        jenisSurat: s.jenisSurat,
        kategori: s.kategori,
        tanggalSurat: s.tanggalSurat ? new Date(s.tanggalSurat) : null,
        pengirim: s.pengirim || null,
        penerima: s.penerima || null,
        perihal: s.perihal,
        deskripsi: s.deskripsi || null,
        status: s.status,
        catatan: s.catatan || null,
        documents: JSON.stringify(s.documents || []),
        driveFolderId: s.driveFolderId || null,
        driveFolderLink: s.driveFolderLink || null,
        location: s.location || null,
        executionTime: s.executionTime || null,
        picName: s.picName || null,
        picWhatsApp: s.picWhatsApp || null,
        administratorId: s.administratorId || null,
        managerId: s.managerId || null,
        projectId: s.projectId || null,
        createdAt: new Date(s.createdAt),
        updatedAt: new Date(s.updatedAt),
      }
    });
  }
  console.log(`✅ Created ${suratList.length} surat`);
  
  // 4. Create default settings
  await prisma.settings.upsert({
    where: { id: 'main' },
    update: {},
    create: {
      id: 'main',
      driveAutoCreate: false,
      maintenanceMode: false,
      notifWaEnabled: false,
      notifEmailEnabled: false,
    }
  });
  console.log('✅ Created default settings');
  
  // Summary
  const userCount = await prisma.user.count();
  const projectCount = await prisma.project.count();
  const taskCount = await prisma.task.count();
  const suratCount = await prisma.surat.count();
  const folderCount = await prisma.driveFolder.count();
  
  console.log('\n=== Database Seeding Complete ===');
  console.log(`Users: ${userCount}`);
  console.log(`Projects: ${projectCount}`);
  console.log(`Tasks: ${taskCount}`);
  console.log(`Drive Folders: ${folderCount}`);
  console.log(`Surat: ${suratCount}`);
}

main()
  .catch(e => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
