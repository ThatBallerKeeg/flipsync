CREATE TABLE "BulkJob" (
    "id"          TEXT NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'processing',
    "phase"       TEXT NOT NULL DEFAULT 'uploading',
    "totalPhotos" INTEGER NOT NULL DEFAULT 0,
    "totalGroups" INTEGER NOT NULL DEFAULT 0,
    "created"     INTEGER NOT NULL DEFAULT 0,
    "results"     JSONB NOT NULL DEFAULT '[]',
    "error"       TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BulkJob_pkey" PRIMARY KEY ("id")
);
