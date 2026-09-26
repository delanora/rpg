-- CreateEnum
CREATE TYPE "CreatureKind" AS ENUM ('CREATURE', 'NPC');

-- AlterTable
ALTER TABLE "combatants" ADD COLUMN     "armorClass" INTEGER,
ADD COLUMN     "hpCurrent" INTEGER,
ADD COLUMN     "hpMax" INTEGER;

-- AlterTable
ALTER TABLE "combats" ADD COLUMN     "localityId" TEXT;

-- AlterTable
ALTER TABLE "creatures" ADD COLUMN     "kind" "CreatureKind" NOT NULL DEFAULT 'CREATURE';

-- CreateTable
CREATE TABLE "localities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "images" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "localities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_CreatureToLocality" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CreatureToLocality_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "localities_name_idx" ON "localities"("name");

-- CreateIndex
CREATE INDEX "_CreatureToLocality_B_index" ON "_CreatureToLocality"("B");

-- CreateIndex
CREATE INDEX "creatures_kind_idx" ON "creatures"("kind");

-- AddForeignKey
ALTER TABLE "combats" ADD CONSTRAINT "combats_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "localities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CreatureToLocality" ADD CONSTRAINT "_CreatureToLocality_A_fkey" FOREIGN KEY ("A") REFERENCES "creatures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CreatureToLocality" ADD CONSTRAINT "_CreatureToLocality_B_fkey" FOREIGN KEY ("B") REFERENCES "localities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
