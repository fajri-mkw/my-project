-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL DEFAULT '$2a$10$placeholder',
    "whatsapp" TEXT,
    "avatar" TEXT,
    "role" TEXT NOT NULL DEFAULT 'Reporter',
    "notifWaEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notifEmailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoApproveReview" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requesterUnit" TEXT NOT NULL,
    "location" TEXT,
    "executionTime" TEXT,
    "picName" TEXT,
    "picWhatsApp" TEXT,
    "activityTypes" TEXT NOT NULL,
    "customActivity" TEXT,
    "outputNeeds" TEXT NOT NULL,
    "customOutput" TEXT,
    "workerOutputs" TEXT DEFAULT '{}',
    "workerCustomOutput" TEXT DEFAULT '{}',
    "currentStage" INTEGER NOT NULL DEFAULT 1,
    "isFastTrack" BOOLEAN NOT NULL DEFAULT false,
    "isFastProduction" BOOLEAN NOT NULL DEFAULT false,
    "enableFotoEditor" BOOLEAN NOT NULL DEFAULT true,
    "enableTemplateEditor" BOOLEAN NOT NULL DEFAULT true,
    "managerId" TEXT NOT NULL,
    "publicToken" TEXT,
    "documents" TEXT DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "projects_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL,
    "stage" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "data" TEXT,
    "revisionCount" INTEGER NOT NULL DEFAULT 0,
    "assignedTo" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tasks_assignedTo_fkey" FOREIGN KEY ("assignedTo") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_tasks_projectId_status" ON "tasks" ("projectId", "status");
CREATE INDEX IF NOT EXISTS "idx_tasks_projectId_stage" ON "tasks" ("projectId", "stage");

-- CreateTable
CREATE TABLE "drive_folders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "folderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "link" TEXT,
    "assignedRoles" TEXT,
    "assignedUsers" TEXT,
    "color" TEXT,
    "bgColor" TEXT,
    "borderColor" TEXT,
    "projectId" TEXT NOT NULL,
    "parentFolderId" TEXT,
    CONSTRAINT "drive_folders_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "message" TEXT NOT NULL,
    "projectId" TEXT,
    "targetView" TEXT NOT NULL DEFAULT 'project_detail',
    "read" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notifications_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "surat_tugas" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nomorSurat" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "stage" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "surat_tugas_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "surat_tugas_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'main',
    "driveAutoCreate" BOOLEAN NOT NULL DEFAULT false,
    "driveMode" TEXT,
    "driveParentFolderId" TEXT,
    "driveSharedDriveId" TEXT,
    "driveFolderId" TEXT,
    "driveServiceAccountKey" TEXT,
    "driveApiKey" TEXT,
    "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceMessage" TEXT,
    "notifWaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "notifWaToken" TEXT,
    "notifWaDeviceId" TEXT,
    "notifWaSenderNumber" TEXT,
    "notifEmailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "notifEmailHost" TEXT,
    "notifEmailPort" INTEGER,
    "notifEmailUser" TEXT,
    "notifEmailPass" TEXT,
    "notifEmailFromName" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "sops" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'SOP',
    "displayMode" TEXT NOT NULL DEFAULT 'text',
    "files" TEXT,
    "slideshowSpeed" INTEGER NOT NULL DEFAULT 5000,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "authorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "sops_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "permohonan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requesterUnit" TEXT NOT NULL,
    "location" TEXT,
    "executionTime" TEXT,
    "picName" TEXT,
    "picWhatsApp" TEXT,
    "activityTypes" TEXT NOT NULL DEFAULT '[]',
    "customActivity" TEXT,
    "outputNeeds" TEXT NOT NULL DEFAULT '[]',
    "customOutput" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "adminNote" TEXT,
    "documents" TEXT DEFAULT '[]',
    "administratorId" TEXT,
    "managerId" TEXT,
    "projectId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "surat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nomorSurat" TEXT NOT NULL,
    "jenisSurat" TEXT NOT NULL,
    "kategori" TEXT NOT NULL,
    "tanggalSurat" DATETIME,
    "pengirim" TEXT,
    "penerima" TEXT,
    "perihal" TEXT NOT NULL,
    "deskripsi" TEXT,
    "status" TEXT NOT NULL DEFAULT 'diterima',
    "catatan" TEXT,
    "documents" TEXT DEFAULT '[]',
    "driveFolderId" TEXT,
    "driveFolderLink" TEXT,
    "location" TEXT,
    "executionTime" TEXT,
    "picName" TEXT,
    "picWhatsApp" TEXT,
    "administratorId" TEXT,
    "managerId" TEXT,
    "projectId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "program_kegiatan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nomorKegiatan" TEXT NOT NULL,
    "jenisKegiatan" TEXT NOT NULL DEFAULT 'Kegiatan',
    "kategori" TEXT NOT NULL DEFAULT 'Umum',
    "tanggalKegiatan" DATETIME,
    "penyelenggara" TEXT,
    "namaKegiatan" TEXT NOT NULL,
    "deskripsi" TEXT,
    "status" TEXT NOT NULL DEFAULT 'direncanakan',
    "catatan" TEXT,
    "documents" TEXT DEFAULT '[]',
    "driveFolderId" TEXT,
    "driveFolderLink" TEXT,
    "location" TEXT,
    "executionTime" TEXT,
    "picName" TEXT,
    "picWhatsApp" TEXT,
    "managerId" TEXT,
    "projectId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "external_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "icon" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "projects_publicToken_key" ON "projects"("publicToken");

-- CreateIndex
CREATE INDEX "projects_managerId_idx" ON "projects"("managerId");

-- CreateIndex
CREATE INDEX "projects_currentStage_idx" ON "projects"("currentStage");

-- CreateIndex
CREATE INDEX "projects_createdAt_idx" ON "projects"("createdAt");

-- CreateIndex
CREATE INDEX "tasks_projectId_idx" ON "tasks"("projectId");

-- CreateIndex
CREATE INDEX "tasks_assignedTo_idx" ON "tasks"("assignedTo");

-- CreateIndex
CREATE INDEX "tasks_stage_idx" ON "tasks"("stage");

-- CreateIndex
CREATE INDEX "tasks_status_idx" ON "tasks"("status");

-- CreateIndex
CREATE INDEX "drive_folders_projectId_idx" ON "drive_folders"("projectId");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- CreateIndex
CREATE INDEX "notifications_projectId_idx" ON "notifications"("projectId");

-- CreateIndex
CREATE INDEX "notifications_read_idx" ON "notifications"("read");

-- CreateIndex
CREATE UNIQUE INDEX "surat_tugas_nomorSurat_key" ON "surat_tugas"("nomorSurat");

-- CreateIndex
CREATE INDEX "surat_tugas_projectId_idx" ON "surat_tugas"("projectId");

-- CreateIndex
CREATE INDEX "surat_tugas_userId_idx" ON "surat_tugas"("userId");

-- CreateIndex
CREATE INDEX "surat_tugas_status_idx" ON "surat_tugas"("status");

-- CreateIndex
CREATE INDEX "sops_authorId_idx" ON "sops"("authorId");

-- CreateIndex
CREATE INDEX "sops_type_idx" ON "sops"("type");

-- CreateIndex
CREATE INDEX "sops_published_idx" ON "sops"("published");

-- CreateIndex
CREATE INDEX "permohonan_administratorId_idx" ON "permohonan"("administratorId");

-- CreateIndex
CREATE INDEX "permohonan_managerId_idx" ON "permohonan"("managerId");

-- CreateIndex
CREATE INDEX "permohonan_status_idx" ON "permohonan"("status");

-- CreateIndex
CREATE INDEX "surat_administratorId_idx" ON "surat"("administratorId");

-- CreateIndex
CREATE INDEX "surat_managerId_idx" ON "surat"("managerId");

-- CreateIndex
CREATE INDEX "surat_status_idx" ON "surat"("status");

-- CreateIndex
CREATE INDEX "surat_kategori_idx" ON "surat"("kategori");

-- CreateIndex
CREATE INDEX "program_kegiatan_managerId_idx" ON "program_kegiatan"("managerId");

-- CreateIndex
CREATE INDEX "program_kegiatan_status_idx" ON "program_kegiatan"("status");

-- CreateIndex
CREATE INDEX "program_kegiatan_kategori_idx" ON "program_kegiatan"("kategori");

-- CreateIndex
CREATE INDEX "external_links_isActive_idx" ON "external_links"("isActive");

-- CreateIndex
CREATE INDEX "external_links_order_idx" ON "external_links"("order");

