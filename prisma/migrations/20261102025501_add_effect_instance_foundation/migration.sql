-- CreateTable
CREATE TABLE "effect_instances" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "definitionId" TEXT,
    "label" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'manual',
    "sourceId" TEXT,
    "sourceEntityKind" TEXT,
    "sourceEntityId" TEXT,
    "sourceLabel" TEXT,
    "targetEntityKind" TEXT NOT NULL,
    "targetEntityId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "effect_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "effect_operations" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "effect_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "effect_instances_targetEntityKind_targetEntityId_status_idx" ON "effect_instances"("targetEntityKind", "targetEntityId", "status");

-- CreateIndex
CREATE INDEX "effect_instances_sourceEntityKind_sourceEntityId_status_idx" ON "effect_instances"("sourceEntityKind", "sourceEntityId", "status");

-- CreateIndex
CREATE INDEX "effect_instances_groupId_idx" ON "effect_instances"("groupId");

-- CreateIndex
CREATE INDEX "effect_instances_sourceId_idx" ON "effect_instances"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "effect_operations_operationId_key" ON "effect_operations"("operationId");
