-- AlterTable
ALTER TABLE "characters"
    ADD COLUMN "classKey" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "subclass" TEXT NOT NULL DEFAULT '';
