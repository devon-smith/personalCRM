-- M0.x.12: free-form custom voice instructions.
--
-- A textarea on /settings/voice where Jennifer can type prompt-
-- engineering instructions that get applied as the highest-priority
-- block in every outbound message Claude generates (drafts, workspace
-- refinements, variants). Complements VoiceReferences — those are
-- file-based and retrieved by semantic similarity; this is always-on
-- inline guidance.

ALTER TABLE "VoiceProfile"
  ADD COLUMN "userInstructions" TEXT;
