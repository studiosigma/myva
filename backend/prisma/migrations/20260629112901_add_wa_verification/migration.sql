-- AlterTable
ALTER TABLE "users" ADD COLUMN     "wa_verification_code" TEXT,
ADD COLUMN     "wa_verified" BOOLEAN NOT NULL DEFAULT false;
