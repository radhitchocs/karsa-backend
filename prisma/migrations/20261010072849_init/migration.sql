-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('LOBBY', 'ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "OwnerType" AS ENUM ('INDIVIDU', 'KELOMPOK');

-- CreateEnum
CREATE TYPE "QuizStatus" AS ENUM ('READY', 'RUNNING', 'FINISHED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Presentation" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slidesJson" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "Presentation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'LOBBY',
    "slidesSnapshot" JSONB NOT NULL,
    "activeSlide" INTEGER NOT NULL DEFAULT 0,
    "divisionSlide" INTEGER NOT NULL DEFAULT -1,
    "activitiesJson" JSONB NOT NULL DEFAULT '{}',
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "presentationId" TEXT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectorToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectorToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "online" BOOLEAN NOT NULL DEFAULT false,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "sessionId" TEXT NOT NULL,
    "responderVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "isResponder" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Response" (
    "id" TEXT NOT NULL,
    "slideId" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sessionId" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "participantOwnerId" TEXT,
    "groupOwnerId" TEXT,

    CONSTRAINT "Response_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "slideId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT false,
    "answered" BOOLEAN NOT NULL DEFAULT false,
    "sessionId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizSession" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "ownerType" "OwnerType" NOT NULL,
    "status" "QuizStatus" NOT NULL DEFAULT 'READY',
    "duration" INTEGER NOT NULL,
    "configJson" JSONB NOT NULL,
    "finished" BOOLEAN NOT NULL DEFAULT false,
    "revealed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizQuestionRun" (
    "id" TEXT NOT NULL,
    "quizSessionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "openedAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "QuizQuestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizAnswer" (
    "id" TEXT NOT NULL,
    "questionRunId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "optionIndex" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "computedScore" INTEGER NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "participantOwnerId" TEXT,
    "groupOwnerId" TEXT,

    CONSTRAINT "QuizAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizScore" (
    "id" TEXT NOT NULL,
    "quizSessionId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownerType" "OwnerType" NOT NULL,
    "totalScore" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER,

    CONSTRAINT "QuizScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommandReceipt" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "responseJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommandReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_code_key" ON "Session"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectorToken_tokenHash_key" ON "ProjectorToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectorToken_sessionId_key" ON "ProjectorToken"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_tokenHash_key" ON "Participant"("tokenHash");

-- CreateIndex
CREATE INDEX "Participant_sessionId_idx" ON "Participant"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Group_sessionId_number_key" ON "Group"("sessionId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_participantId_key" ON "GroupMember"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_groupId_participantId_key" ON "GroupMember"("groupId", "participantId");

-- CreateIndex
CREATE UNIQUE INDEX "Response_sessionId_slideId_participantOwnerId_key" ON "Response"("sessionId", "slideId", "participantOwnerId");

-- CreateIndex
CREATE UNIQUE INDEX "Response_sessionId_slideId_groupOwnerId_key" ON "Response"("sessionId", "slideId", "groupOwnerId");

-- CreateIndex
CREATE INDEX "Question_sessionId_slideId_idx" ON "Question"("sessionId", "slideId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizSession_sessionId_key" ON "QuizSession"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizQuestionRun_quizSessionId_questionId_key" ON "QuizQuestionRun"("quizSessionId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizAnswer_questionRunId_participantOwnerId_key" ON "QuizAnswer"("questionRunId", "participantOwnerId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizAnswer_questionRunId_groupOwnerId_key" ON "QuizAnswer"("questionRunId", "groupOwnerId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizAnswer_questionRunId_requestId_key" ON "QuizAnswer"("questionRunId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizScore_quizSessionId_ownerId_key" ON "QuizScore"("quizSessionId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "CommandReceipt_sessionId_actorId_requestId_key" ON "CommandReceipt"("sessionId", "actorId", "requestId");

-- AddForeignKey
ALTER TABLE "Presentation" ADD CONSTRAINT "Presentation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "Presentation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectorToken" ADD CONSTRAINT "ProjectorToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Response" ADD CONSTRAINT "Response_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Response" ADD CONSTRAINT "Response_participantOwnerId_fkey" FOREIGN KEY ("participantOwnerId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Response" ADD CONSTRAINT "Response_groupOwnerId_fkey" FOREIGN KEY ("groupOwnerId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizSession" ADD CONSTRAINT "QuizSession_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizQuestionRun" ADD CONSTRAINT "QuizQuestionRun_quizSessionId_fkey" FOREIGN KEY ("quizSessionId") REFERENCES "QuizSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAnswer" ADD CONSTRAINT "QuizAnswer_questionRunId_fkey" FOREIGN KEY ("questionRunId") REFERENCES "QuizQuestionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAnswer" ADD CONSTRAINT "QuizAnswer_participantOwnerId_fkey" FOREIGN KEY ("participantOwnerId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizScore" ADD CONSTRAINT "QuizScore_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandReceipt" ADD CONSTRAINT "CommandReceipt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
