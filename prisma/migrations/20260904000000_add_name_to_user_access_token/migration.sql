-- Add a display name for each user access token.
ALTER TABLE "UserAccessToken" ADD COLUMN "name" TEXT;
