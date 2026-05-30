CREATE TABLE IF NOT EXISTS "Photo" (
    "id"          TEXT NOT NULL,
    "filename"    TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size"        INTEGER NOT NULL DEFAULT 0,
    "data"        BYTEA NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);
