import { prisma } from "@/lib/prisma";

export interface UpcomingBirthday {
  readonly id: string;
  readonly name: string;
  readonly company: string | null;
  readonly avatarUrl: string | null;
  readonly birthday: string; // ISO date string
  readonly daysUntil: number;
  readonly isToday: boolean;
}

export async function getUpcomingBirthdays(
  userId: string,
  days: number = 30,
): Promise<readonly UpcomingBirthday[]> {
  const contacts = await prisma.contact.findMany({
    where: { userId, birthday: { not: null } },
    select: {
      id: true,
      name: true,
      company: true,
      avatarUrl: true,
      birthday: true,
    },
  });

  const now = new Date();
  const todayMonth = now.getMonth();
  const todayDate = now.getDate();

  const results: UpcomingBirthday[] = [];

  for (const contact of contacts) {
    if (!contact.birthday) continue;

    const bday = new Date(contact.birthday);
    const bdayMonth = bday.getMonth();
    const bdayDate = bday.getDate();

    // Calculate next occurrence
    let nextBirthday = new Date(now.getFullYear(), bdayMonth, bdayDate);
    if (
      nextBirthday.getMonth() < todayMonth ||
      (nextBirthday.getMonth() === todayMonth && nextBirthday.getDate() < todayDate)
    ) {
      nextBirthday = new Date(now.getFullYear() + 1, bdayMonth, bdayDate);
    }

    const diffMs = nextBirthday.getTime() - new Date(now.getFullYear(), todayMonth, todayDate).getTime();
    const daysUntil = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (daysUntil <= days) {
      results.push({
        id: contact.id,
        name: contact.name,
        company: contact.company,
        avatarUrl: contact.avatarUrl,
        birthday: contact.birthday.toISOString(),
        daysUntil,
        isToday: daysUntil === 0,
      });
    }
  }

  return results.sort((a, b) => a.daysUntil - b.daysUntil);
}
