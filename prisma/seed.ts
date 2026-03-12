import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  // Clean existing data
  await prisma.interaction.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();

  // Create a demo user
  const user = await prisma.user.create({
    data: {
      name: "Devon Smith",
      email: "devon@example.com",
      image: null,
    },
  });

  console.log(`Created user: ${user.name}`);

  // Create 15 contacts across all 3 tiers
  const contactsData = [
    // Inner Circle (5)
    {
      name: "Sarah Chen",
      email: "sarah.chen@techcorp.com",
      company: "TechCorp",
      role: "Engineering Manager",
      tier: "INNER_CIRCLE" as const,
      tags: ["mentor", "engineering", "referral"],
      linkedinUrl: "https://linkedin.com/in/sarahchen",
      notes: "Met at React Conf 2025. Great mentor for career growth.",
      followUpDays: 14,
      lastInteraction: daysAgo(5),
    },
    {
      name: "Marcus Johnson",
      email: "marcus.j@startup.io",
      company: "Startup.io",
      role: "Co-Founder",
      tier: "INNER_CIRCLE" as const,
      tags: ["founder", "startup", "investor"],
      notes: "College roommate. Building an AI startup.",
      followUpDays: 10,
      lastInteraction: daysAgo(20),
    },
    {
      name: "Priya Patel",
      email: "priya@designlab.com",
      company: "DesignLab",
      role: "Head of Product",
      tier: "INNER_CIRCLE" as const,
      tags: ["product", "design", "hiring"],
      notes: "Worked together at previous company. Always happy to help.",
      followUpDays: 14,
      lastInteraction: daysAgo(3),
    },
    {
      name: "James Kim",
      email: "jkim@bigtech.com",
      company: "BigTech Inc",
      role: "Staff Engineer",
      tier: "INNER_CIRCLE" as const,
      tags: ["engineering", "systems", "referral"],
      notes: "Great technical discussions. Referred me to BigTech.",
      followUpDays: 14,
      lastInteraction: daysAgo(45),
    },
    {
      name: "Elena Rodriguez",
      email: "elena.r@venture.vc",
      company: "Venture Capital Co",
      role: "Partner",
      tier: "INNER_CIRCLE" as const,
      tags: ["vc", "advisor", "networking"],
      notes: "Angel investor contact. Interested in AI/ML projects.",
      followUpDays: 21,
      lastInteraction: daysAgo(8),
    },
    // Professional (5)
    {
      name: "Tom Williams",
      email: "twilliams@cloudco.com",
      company: "CloudCo",
      role: "Senior Developer",
      tier: "PROFESSIONAL" as const,
      tags: ["engineering", "cloud", "aws"],
      notes: "Met at AWS re:Invent. Good contact for cloud architecture.",
      followUpDays: 30,
      lastInteraction: daysAgo(35),
    },
    {
      name: "Lisa Chang",
      email: "lchang@recruiter.com",
      company: "TalentFirst",
      role: "Senior Recruiter",
      tier: "PROFESSIONAL" as const,
      tags: ["recruiter", "jobs", "tech"],
      notes: "Specializes in senior engineering roles.",
      followUpDays: 30,
      lastInteraction: daysAgo(12),
    },
    {
      name: "David Park",
      email: "dpark@fintech.com",
      company: "FinTech Solutions",
      role: "VP Engineering",
      tier: "PROFESSIONAL" as const,
      tags: ["engineering", "fintech", "hiring-manager"],
      notes: "Hiring for senior roles. Team uses React + Node.",
      followUpDays: 30,
      lastInteraction: daysAgo(60),
    },
    {
      name: "Amy Foster",
      email: "amy.foster@dataco.com",
      company: "DataCo",
      role: "Data Science Lead",
      tier: "PROFESSIONAL" as const,
      tags: ["data-science", "ml", "python"],
      notes: "Interesting work in ML infrastructure.",
      followUpDays: 30,
      lastInteraction: daysAgo(25),
    },
    {
      name: "Ryan O'Brien",
      email: "robrien@agency.dev",
      company: "Dev Agency",
      role: "Technical Director",
      tier: "PROFESSIONAL" as const,
      tags: ["freelance", "consulting", "web"],
      notes: "Good source for freelance referrals.",
      followUpDays: 30,
      lastInteraction: daysAgo(40),
    },
    // Acquaintance (5)
    {
      name: "Nina Petrova",
      email: "nina.p@university.edu",
      company: "State University",
      role: "CS Professor",
      tier: "ACQUAINTANCE" as const,
      tags: ["academic", "research", "ai"],
      notes: "Met at a conference talk on transformers.",
      followUpDays: 90,
      lastInteraction: daysAgo(100),
    },
    {
      name: "Carlos Mendez",
      email: "cmendez@bigcorp.com",
      company: "BigCorp",
      role: "Product Manager",
      tier: "ACQUAINTANCE" as const,
      tags: ["product", "enterprise"],
      notes: "Connected on LinkedIn after a meetup.",
      followUpDays: 90,
      lastInteraction: daysAgo(50),
    },
    {
      name: "Hannah Lee",
      email: "hlee@nonprofit.org",
      company: "Tech For Good",
      role: "Executive Director",
      tier: "ACQUAINTANCE" as const,
      tags: ["nonprofit", "social-impact"],
      notes: "Runs a coding bootcamp for underrepresented groups.",
      followUpDays: 90,
      lastInteraction: daysAgo(70),
    },
    {
      name: "Oliver Grant",
      email: "ogrant@mediagroup.com",
      company: "Media Group",
      role: "Content Strategist",
      tier: "ACQUAINTANCE" as const,
      tags: ["content", "marketing", "writing"],
      notes: "Interesting perspective on developer content.",
      lastInteraction: daysAgo(120),
    },
    {
      name: "Zoe Martinez",
      email: "zoe@freelance.dev",
      company: "Freelance",
      role: "Full-Stack Developer",
      tier: "ACQUAINTANCE" as const,
      tags: ["freelance", "react", "nextjs"],
      notes: "Met at a local JS meetup.",
      lastInteraction: daysAgo(30),
    },
  ];

  const contacts = await Promise.all(
    contactsData.map((data) =>
      prisma.contact.create({
        data: {
          userId: user.id,
          ...data,
        },
      })
    )
  );

  console.log(`Created ${contacts.length} contacts`);

  // Create 20 interactions across various contacts
  const interactionsData = [
    { contactIdx: 0, type: "EMAIL" as const, direction: "OUTBOUND" as const, subject: "Application follow-up", summary: "Sent thank you email after referral", occurredAt: daysAgo(5), channel: "gmail" },
    { contactIdx: 0, type: "MEETING" as const, direction: "OUTBOUND" as const, subject: "Coffee chat", summary: "Discussed TechCorp culture and team dynamics", occurredAt: daysAgo(10) },
    { contactIdx: 1, type: "CALL" as const, direction: "INBOUND" as const, subject: "Founding engineer role", summary: "Marcus pitched the founding engineer position", occurredAt: daysAgo(20) },
    { contactIdx: 1, type: "MESSAGE" as const, direction: "OUTBOUND" as const, subject: "On-site prep", summary: "Asked about what to expect for the on-site", occurredAt: daysAgo(15), channel: "slack" },
    { contactIdx: 2, type: "EMAIL" as const, direction: "INBOUND" as const, subject: "Product role at DesignLab", summary: "Priya shared an interesting product role opening", occurredAt: daysAgo(3), channel: "gmail" },
    { contactIdx: 2, type: "MEETING" as const, direction: "OUTBOUND" as const, subject: "Lunch catch-up", summary: "Caught up over lunch, discussed career moves", occurredAt: daysAgo(14) },
    { contactIdx: 3, type: "EMAIL" as const, direction: "OUTBOUND" as const, subject: "BigTech new team", summary: "Asked James about the new team forming", occurredAt: daysAgo(45), channel: "gmail" },
    { contactIdx: 4, type: "MEETING" as const, direction: "OUTBOUND" as const, subject: "Advisor meeting", summary: "Discussed startup landscape and fundraising", occurredAt: daysAgo(8) },
    { contactIdx: 4, type: "EMAIL" as const, direction: "INBOUND" as const, subject: "Intro to portfolio company", summary: "Elena offered to introduce me to a portfolio company CTO", occurredAt: daysAgo(6), channel: "gmail" },
    { contactIdx: 5, type: "EMAIL" as const, direction: "OUTBOUND" as const, subject: "CloudCo follow-up", summary: "Followed up after rejection for feedback", occurredAt: daysAgo(35), channel: "gmail" },
    { contactIdx: 6, type: "CALL" as const, direction: "INBOUND" as const, subject: "New opportunities", summary: "Lisa called about several senior roles in the market", occurredAt: daysAgo(12) },
    { contactIdx: 6, type: "EMAIL" as const, direction: "INBOUND" as const, subject: "Job descriptions", summary: "Sent over 3 JDs for senior engineering roles", occurredAt: daysAgo(11), channel: "gmail" },
    { contactIdx: 7, type: "EMAIL" as const, direction: "INBOUND" as const, subject: "Phone screen invite", summary: "David scheduled the phone screen for next week", occurredAt: daysAgo(7), channel: "gmail" },
    { contactIdx: 8, type: "MESSAGE" as const, direction: "OUTBOUND" as const, subject: "ML infra question", summary: "Asked about their ML pipeline architecture", occurredAt: daysAgo(25), channel: "linkedin" },
    { contactIdx: 9, type: "EMAIL" as const, direction: "INBOUND" as const, subject: "Freelance project", summary: "Ryan has a potential freelance React project", occurredAt: daysAgo(40), channel: "gmail" },
    { contactIdx: 10, type: "NOTE" as const, direction: "OUTBOUND" as const, subject: "Conference notes", summary: "Great talk on transformer architectures", occurredAt: daysAgo(100) },
    { contactIdx: 11, type: "MESSAGE" as const, direction: "OUTBOUND" as const, subject: "Meetup follow-up", summary: "Connected on LinkedIn after product meetup", occurredAt: daysAgo(50), channel: "linkedin" },
    { contactIdx: 12, type: "EMAIL" as const, direction: "OUTBOUND" as const, subject: "Volunteering interest", summary: "Expressed interest in volunteering as a mentor", occurredAt: daysAgo(70), channel: "gmail" },
    { contactIdx: 13, type: "NOTE" as const, direction: "OUTBOUND" as const, subject: "Content ideas", summary: "Oliver shared insights on developer blog strategy", occurredAt: daysAgo(120) },
    { contactIdx: 14, type: "MEETING" as const, direction: "OUTBOUND" as const, subject: "JS Meetup", summary: "Met Zoe at the local JavaScript meetup, discussed Next.js", occurredAt: daysAgo(30) },
  ];

  const interactions = await Promise.all(
    interactionsData.map(({ contactIdx, ...data }) =>
      prisma.interaction.create({
        data: {
          userId: user.id,
          contactId: contacts[contactIdx].id,
          ...data,
        },
      })
    )
  );

  console.log(`Created ${interactions.length} interactions`);
  console.log("\nSeeding complete!");
}

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
