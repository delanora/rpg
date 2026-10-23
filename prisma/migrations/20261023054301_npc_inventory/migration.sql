-- AlterTable
ALTER TABLE "creatures" ADD COLUMN     "coins" JSONB NOT NULL DEFAULT '{"pp":0,"gp":0,"ep":0,"sp":0,"cp":0}',
ADD COLUMN     "inventory" JSONB NOT NULL DEFAULT '[]';
