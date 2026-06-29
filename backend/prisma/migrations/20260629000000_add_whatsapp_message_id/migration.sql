-- AlterTable
ALTER TABLE "messages" ADD COLUMN "whatsapp_message_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "messages_whatsapp_message_id_key" ON "messages"("whatsapp_message_id");
