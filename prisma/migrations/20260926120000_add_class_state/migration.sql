-- AlterTable
ALTER TABLE "characters"
    ADD COLUMN "classState" JSONB NOT NULL DEFAULT '{}';
