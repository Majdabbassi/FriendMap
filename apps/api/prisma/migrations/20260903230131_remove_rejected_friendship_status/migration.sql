-- AlterEnum
BEGIN;
CREATE TYPE "FriendshipStatus_new" AS ENUM ('PENDING', 'ACCEPTED');
ALTER TABLE "Friendship" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Friendship" ALTER COLUMN "status" TYPE "FriendshipStatus_new" USING ("status"::text::"FriendshipStatus_new");
ALTER TABLE "Friendship" ALTER COLUMN "status" SET DEFAULT 'PENDING';
DROP TYPE "FriendshipStatus";
ALTER TYPE "FriendshipStatus_new" RENAME TO "FriendshipStatus";
COMMIT;
