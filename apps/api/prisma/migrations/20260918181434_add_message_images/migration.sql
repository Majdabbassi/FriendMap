-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "imageUrl" TEXT,
ALTER COLUMN "body" DROP NOT NULL;