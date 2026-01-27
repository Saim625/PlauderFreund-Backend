-- CreateTable
CREATE TABLE "AdminAccessToken" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canManageUsers" BOOLEAN NOT NULL DEFAULT false,
    "canCreateTokens" BOOLEAN NOT NULL DEFAULT false,
    "canDeleteTokens" BOOLEAN NOT NULL DEFAULT false,
    "canEditAdmin" BOOLEAN NOT NULL DEFAULT false,
    "canAccessMemoryEditor" BOOLEAN NOT NULL DEFAULT false,
    "canAccessPersonalisedConfig" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AdminAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAccountPassword" (
    "id" SERIAL NOT NULL,
    "role" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT 'kontakt@seniorenassistenz-henning.de',
    "passwordHash" TEXT NOT NULL,
    "resetPasswordToken" TEXT,
    "resetPasswordTokenExpiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAccountPassword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" SERIAL NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conversationId" INTEGER NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemorySummaryItem" (
    "id" SERIAL NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "memorySummaryId" INTEGER NOT NULL,

    CONSTRAINT "MemorySummaryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemorySummary" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemorySummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalityConfig" (
    "id" SERIAL NOT NULL,
    "userToken" TEXT NOT NULL,
    "voiceId" TEXT,
    "speakingSpeed" TEXT NOT NULL DEFAULT 'normal',
    "empathyLevel" TEXT NOT NULL DEFAULT 'medium',
    "activePrompting" BOOLEAN NOT NULL DEFAULT true,
    "reminderOffers" BOOLEAN NOT NULL DEFAULT true,
    "reengageAfterSilence" BOOLEAN NOT NULL DEFAULT true,
    "expertise" TEXT NOT NULL DEFAULT 'general',
    "calm" BOOLEAN NOT NULL DEFAULT true,
    "humorous" BOOLEAN NOT NULL DEFAULT false,
    "supportive" BOOLEAN NOT NULL DEFAULT true,
    "direct" BOOLEAN NOT NULL DEFAULT false,
    "conversationGuidelines" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalityConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminAccessToken_token_key" ON "AdminAccessToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "AdminAccountPassword_email_key" ON "AdminAccountPassword"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_token_key" ON "Conversation"("token");

-- CreateIndex
CREATE UNIQUE INDEX "MemorySummary_token_key" ON "MemorySummary"("token");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalityConfig_userToken_key" ON "PersonalityConfig"("userToken");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemorySummaryItem" ADD CONSTRAINT "MemorySummaryItem_memorySummaryId_fkey" FOREIGN KEY ("memorySummaryId") REFERENCES "MemorySummary"("id") ON DELETE CASCADE ON UPDATE CASCADE;
