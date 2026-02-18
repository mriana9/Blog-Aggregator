import { db } from "./index.js";
import { feedFollows, feeds, posts, users } from "./schema.js";
import { eq, and, sql, desc } from "drizzle-orm";

export async function createUser(name: string) {
  const [result] = await db.insert(users).values({ name: name }).returning();
  return result;
}

export async function getUser(name: string) {
  const result = await db.query.users.findFirst({
    where: eq(users.name, name),
  });
  return result;
}

export async function deleteAllUsers() {
  await db.delete(users);
}

export async function getUsers() {
  return await db.select().from(users);
}

export async function createFeed(name: string, url: string, userId: string) {
  const [result] = await db
    .insert(feeds)
    .values({
      name,
      url,
      userId,
    })
    .returning();
  return result;
}

export async function getAllFeeds() {
  return await db
    .select({
      name: feeds.name,
      url: feeds.url,
      userName: users.name,
    })
    .from(feeds)
    .innerJoin(users, eq(feeds.userId, users.id));
}

export async function createFeedFollow(userId: string, feedId: string) {
  await db.insert(feedFollows).values({ userId, feedId });

  const [result] = await db
    .select({
      userName: users.name,
      feedName: feeds.name,
    })
    .from(feedFollows)
    .innerJoin(users, eq(feedFollows.userId, users.id))
    .innerJoin(feeds, eq(feedFollows.feedId, feeds.id))
    .where(and(eq(feedFollows.userId, userId), eq(feedFollows.feedId, feedId)));

  return result;
}

export async function getFeedByUrl(url: string) {
  const [result] = await db.select().from(feeds).where(eq(feeds.url, url));
  return result;
}

export async function getFeedFollowsForUser(userId: string) {
  return await db
    .select({
      feedName: feeds.name,
    })
    .from(feedFollows)
    .innerJoin(feeds, eq(feedFollows.feedId, feeds.id))
    .where(eq(feedFollows.userId, userId));
}

export async function deleteFeedFollow(userId: string, feedId: string) {
  await db
    .delete(feedFollows)
    .where(and(eq(feedFollows.userId, userId), eq(feedFollows.feedId, feedId)));
}

export async function markFeedFetched(feedId: string) {
  await db
    .update(feeds)
    .set({ lastFetchedAt: new Date(), updatedAt: new Date() })
    .where(eq(feeds.id, feedId));
}

export async function getNextFeedToFetch() {
  const [result] = await db
    .select()
    .from(feeds)
    .orderBy(sql`${feeds.lastFetchedAt} ASC NULLS FIRST`)
    .limit(1);
  return result;
}

export async function createPost(
  title: string,
  url: string,
  description: string | null,
  publishedAt: Date,
  feedId: string,
) {
  const [result] = await db
    .insert(posts)
    .values({
      title,
      url,
      description,
      publishedAt,
      feedId,
    })
    .onConflictDoNothing()
    .returning();
  return result;
}

export async function getPostsForUser(userId: string, limit = 2) {
  return await db
    .select({
      title: posts.title,
      url: posts.url,
      publishedAt: posts.publishedAt,
      feedName: feeds.name,
    })
    .from(posts)
    .innerJoin(feeds, eq(posts.feedId, feeds.id))
    .innerJoin(feedFollows, eq(feeds.id, feedFollows.feedId))
    .where(eq(feedFollows.userId, userId))
    .orderBy(desc(posts.publishedAt))
    .limit(limit);
}
