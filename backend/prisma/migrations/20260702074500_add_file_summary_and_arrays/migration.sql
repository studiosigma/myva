-- AlterTable
ALTER TABLE "files" ADD COLUMN     "summary" TEXT,
ADD COLUMN     "key_points" TEXT[],
ADD COLUMN     "action_items" TEXT[];
