import { redirect } from "next/navigation";

/**
 * /queries — superseded by /ask in M0.x.7.
 *
 * The new /ask page replaces this: every query now auto-saves with
 * its answer, history is browsable + starrable + searchable, deep
 * links work via /ask/[id]. This route stays as a server-side
 * redirect so any stale bookmarks land in the right place.
 */
export default function QueriesPage() {
  redirect("/ask");
}
