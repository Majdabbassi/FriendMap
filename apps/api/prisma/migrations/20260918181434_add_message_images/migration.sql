-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "imageContentType" TEXT,
ADD COLUMN     "imageData" TEXT,
ALTER COLUMN "body" DROP NOT NULL;
