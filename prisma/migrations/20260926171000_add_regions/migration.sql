-- Regiões agrupam localidades; as criaturas/NPCs continuam presos às
-- localidades. Para não perder o que já existia, cada localidade vira uma
-- região de mesmo nome (o mestre reorganiza depois).

CREATE TABLE "regions" (
  "id"          TEXT         NOT NULL,
  "name"        TEXT         NOT NULL,
  "description" TEXT         NOT NULL DEFAULT '',
  "notes"       TEXT         NOT NULL DEFAULT '',
  "images"      JSONB        NOT NULL DEFAULT '[]',
  "version"     INTEGER      NOT NULL DEFAULT 1,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "regions_name_idx" ON "regions"("name");

ALTER TABLE "localities" ADD COLUMN "regionId" TEXT;

-- Uma região para cada localidade existente (id derivado para ser rastreável).
INSERT INTO "regions" ("id", "name", "description", "notes", "images", "version", "createdAt", "updatedAt")
SELECT 'reg' || "id", "name", '', '', '[]'::jsonb, 1, "createdAt", "updatedAt"
FROM "localities";

UPDATE "localities" SET "regionId" = 'reg' || "id";

ALTER TABLE "localities" ALTER COLUMN "regionId" SET NOT NULL;

ALTER TABLE "localities"
  ADD CONSTRAINT "localities_regionId_fkey"
  FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "localities_regionId_idx" ON "localities"("regionId");
