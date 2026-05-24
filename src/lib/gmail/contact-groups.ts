/**
 * Google People API "contactGroups" client. Used to mirror CRM Circles
 * out to Google so they show up in the user's address book on phone
 * and across other devices.
 *
 * Resource names look like "contactGroups/{id}" for the group and
 * "people/{id}" for each member.
 *
 * https://developers.google.com/people/api/rest/v1/contactGroups
 */

import { googleFetchWithToken } from "./client";

const BASE = "https://people.googleapis.com/v1";

export interface ContactGroup {
  resourceName: string;
  name: string;
  groupType: string;
  memberCount: number;
  memberResourceNames?: string[];
}

interface RawContactGroup {
  resourceName?: string;
  name?: string;
  formattedName?: string;
  groupType?: string;
  memberCount?: number;
  memberResourceNames?: string[];
}

interface ListResponse {
  contactGroups?: RawContactGroup[];
  nextPageToken?: string;
}

/**
 * List all USER_CONTACT_GROUP entries (skipping system groups like
 * "My Contacts" / "Starred").
 */
export async function listContactGroups(token: string): Promise<ContactGroup[]> {
  const out: ContactGroup[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const url = new URL(`${BASE}/contactGroups`);
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await googleFetchWithToken(token, url.toString());
    if (!res.ok) {
      throw new Error(`contactGroups.list ${res.status}`);
    }
    const data = (await res.json()) as ListResponse;
    for (const g of data.contactGroups ?? []) {
      if (g.groupType !== "USER_CONTACT_GROUP") continue;
      out.push({
        resourceName: g.resourceName ?? "",
        name: g.formattedName ?? g.name ?? "",
        groupType: g.groupType,
        memberCount: g.memberCount ?? 0,
        memberResourceNames: g.memberResourceNames,
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

/** Create a new contact group with the given name. */
export async function createContactGroup(
  token: string,
  name: string,
): Promise<ContactGroup> {
  const res = await googleFetchWithToken(token, `${BASE}/contactGroups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contactGroup: { name } }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`contactGroups.create ${res.status}: ${body.slice(0, 200)}`);
  }
  const g = (await res.json()) as RawContactGroup;
  return {
    resourceName: g.resourceName ?? "",
    name: g.formattedName ?? g.name ?? name,
    groupType: g.groupType ?? "USER_CONTACT_GROUP",
    memberCount: g.memberCount ?? 0,
  };
}

/** Rename a contact group. */
export async function updateContactGroupName(
  token: string,
  resourceName: string,
  newName: string,
): Promise<void> {
  const res = await googleFetchWithToken(
    token,
    `${BASE}/${resourceName}?updatePersonFields=name`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactGroup: { name: newName },
        updateGroupFields: "name",
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`contactGroups.update ${res.status}: ${body.slice(0, 200)}`);
  }
}

/**
 * Add or remove members. People API caps each call at 1000 added +
 * 1000 removed; the caller is responsible for chunking large diffs.
 *
 * @param peopleResourceNames Identifiers like "people/c123..." — NOT emails.
 */
export async function modifyContactGroupMembers(
  token: string,
  resourceName: string,
  add: string[],
  remove: string[],
): Promise<void> {
  if (add.length === 0 && remove.length === 0) return;

  const res = await googleFetchWithToken(
    token,
    `${BASE}/${resourceName}/members:modify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resourceNamesToAdd: add,
        resourceNamesToRemove: remove,
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `contactGroups.members:modify ${res.status}: ${body.slice(0, 200)}`,
    );
  }
}

/** Fetch a single contact group including its current member list. */
export async function getContactGroup(
  token: string,
  resourceName: string,
): Promise<ContactGroup | null> {
  const url = new URL(`${BASE}/${resourceName}`);
  url.searchParams.set("maxMembers", "10000");

  const res = await googleFetchWithToken(token, url.toString());
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`contactGroups.get ${res.status}`);
  }
  const g = (await res.json()) as RawContactGroup;
  return {
    resourceName: g.resourceName ?? resourceName,
    name: g.formattedName ?? g.name ?? "",
    groupType: g.groupType ?? "USER_CONTACT_GROUP",
    memberCount: g.memberCount ?? 0,
    memberResourceNames: g.memberResourceNames ?? [],
  };
}
