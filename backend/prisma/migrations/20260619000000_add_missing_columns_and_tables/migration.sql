-- AlterTable: Add missing columns to users table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'user';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_code" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referred_by_id" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "affiliate_balance" DOUBLE PRECISION NOT NULL DEFAULT 0.0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "affiliate_total_earned" DOUBLE PRECISION NOT NULL DEFAULT 0.0;

-- AlterTable: Add missing columns to usage_logs table
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "tokens_input" INTEGER;
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "tokens_output" INTEGER;
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "cost" DOUBLE PRECISION;

-- CreateTable: commission_logs
CREATE TABLE IF NOT EXISTS "commission_logs" (
    "id" TEXT NOT NULL,
    "referrer_id" TEXT NOT NULL,
    "referred_user_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "payment_amount" DOUBLE PRECISION NOT NULL,
    "percentage" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: payout_requests
CREATE TABLE IF NOT EXISTS "payout_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payment_method" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable: system_configs
CREATE TABLE IF NOT EXISTS "system_configs" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("key")
);

-- CreateIndex: unique referral code
CREATE UNIQUE INDEX IF NOT EXISTS "users_referral_code_key" ON "users"("referral_code");

-- AddForeignKey: users self-referral relation
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_id_fkey" FOREIGN KEY ("referred_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: commission_logs -> referrer
ALTER TABLE "commission_logs" ADD CONSTRAINT "commission_logs_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: commission_logs -> referred user
ALTER TABLE "commission_logs" ADD CONSTRAINT "commission_logs_referred_user_id_fkey" FOREIGN KEY ("referred_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: payout_requests -> user
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
