import { readConfig, setUser } from "./config.js";
import {
  createFeed,
  createFeedFollow,
  createPost,
  createUser,
  deleteAllUsers,
  deleteFeedFollow,
  getAllFeeds,
  getFeedByUrl,
  getFeedFollowsForUser,
  getNextFeedToFetch,
  getPostsForUser,
  getUser,
  getUsers,
  markFeedFetched,
} from "./db/queries.js";
import { feeds, users } from "./db/schema.js";
import { fetchFeed } from "./rss.js";

type CommandHandler = (cmdName: string, ...args: string[]) => Promise<void>;
type CommandsRegistry = Record<string, CommandHandler>;

type Feed = typeof feeds.$inferSelect;
type User = typeof users.$inferSelect;

type UserCommandHandler = (
  cmdName: string,
  user: User,
  ...args: string[]
) => Promise<void>;

type MiddlewareLoggedIn = (handler: UserCommandHandler) => CommandHandler;

function registerCommand(
  registry: CommandsRegistry,
  cmdName: string,
  handler: CommandHandler,
) {
  registry[cmdName] = handler;
}

async function runCommand(
  registry: CommandsRegistry,
  cmdName: string,
  ...args: string[]
) {
  const handler = registry[cmdName];
  if (!handler) {
    throw new Error(`Command '${cmdName}' not found`);
  }
  await handler(cmdName, ...args);
}

async function handlerRegister(cmdName: string, ...args: string[]) {
  if (args.length === 0) {
    throw new Error("The register handler expects a username.");
  }
  const name = args[0];

  try {
    const user = await createUser(name);
    const config = readConfig();
    setUser(config, user.name);
    console.log("User created successfully:");
    console.log(user);
  } catch (err) {
    throw new Error(`User '${name}' already exists or failed to create.`);
  }
}

async function handlerLogin(cmdName: string, ...args: string[]) {
  if (args.length === 0) {
    throw new Error("Username is required.");
  }
  const name = args[0];
  const user = await getUser(name);

  if (!user) {
    throw new Error(`User '${name}' does not exist.`);
  }

  const config = readConfig();
  setUser(config, user.name);
  console.log(`Logged in as: ${user.name}`);
}

async function handlerReset(cmdName: string, ...args: string[]) {
  try {
    await deleteAllUsers();
    console.log("Database reset successfully. All users have been deleted.");
  } catch (err) {
    throw new Error("Failed to reset database.");
  }
}

async function handlerUsers(cmdName: string, ...args: string[]) {
  const allUsers = await getUsers();
  const config = readConfig();

  allUsers.forEach((user) => {
    let output = `* ${user.name}`;
    if (user.name === config.currentUserName) {
      output += " (current)";
    }
    console.log(output);
  });
}

async function handlerAgg(cmdName: string, ...args: string[]) {
  if (args.length < 1)
    throw new Error("Usage: npm run start agg <time_between_reqs>");

  const timeBetweenRequests = parseDuration(args[0]);
  console.log(`Collecting feeds every ${args[0]}...`);

  scrapeFeeds();

  const interval = setInterval(() => {
    scrapeFeeds();
  }, timeBetweenRequests);

  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      console.log("\nShutting down feed aggregator...");
      clearInterval(interval);
      resolve();
    });
  });
}

function printFeed(feed: Feed, user: User) {
  console.log("* ID:            ", feed.id);
  console.log("* Created:       ", feed.createdAt);
  console.log("* Updated:       ", feed.updatedAt);
  console.log("* Name:          ", feed.name);
  console.log("* URL:           ", feed.url);
  console.log("* User:          ", user.name);
}

async function handlerAddFeed(cmdName: string, user: User, ...args: string[]) {
  if (args.length < 2) {
    throw new Error("Usage: npm run start addfeed <name> <url>");
  }

  const feed = await createFeed(args[0], args[1], user.id);
  await createFeedFollow(user.id, feed.id);

  console.log("Feed added successfully:");
  printFeed(feed, user);
}

async function handlerListFeeds(cmdName: string, ...args: string[]) {
  const feedsList = await getAllFeeds();

  if (feedsList.length === 0) {
    console.log("No feeds found in the database.");
    return;
  }

  feedsList.forEach((feed) => {
    console.log(`* Name:     ${feed.name}`);
    console.log(`  URL:      ${feed.url}`);
    console.log(`  Created By: ${feed.userName}`);
    console.log("--------------------");
  });
}

async function handlerFollow(cmdName: string, user: User, ...args: string[]) {
  if (args.length < 1) {
    throw new Error("Usage: npm run start follow <url>");
  }

  const feed = await getFeedByUrl(args[0]);
  if (!feed) {
    throw new Error("Feed not found.");
  }

  const follow = await createFeedFollow(user.id, feed.id);
  console.log(
    `User '${follow.userName}' is now following '${follow.feedName}'`,
  );
}

async function handlerFollowing(
  cmdName: string,
  user: User,
  ...args: string[]
) {
  const follows = await getFeedFollowsForUser(user.id);

  if (follows.length === 0) {
    console.log(`${user.name} is not following any feeds.`);
    return;
  }

  console.log(`Feeds followed by ${user.name}:`);
  follows.forEach((f) => console.log(`* ${f.feedName}`));
}

const middlewareLoggedIn: MiddlewareLoggedIn = (handler) => {
  return async (cmdName, ...args) => {
    const config = readConfig();
    if (!config.currentUserName) {
      throw new Error("No user logged in. Please login first.");
    }

    const user = await getUser(config.currentUserName);
    if (!user) {
      throw new Error(
        `User '${config.currentUserName}' not found in database.`,
      );
    }

    return handler(cmdName, user, ...args);
  };
};

async function handlerUnfollow(cmdName: string, user: User, ...args: string[]) {
  if (args.length < 1) {
    throw new Error("Usage: npm run start unfollow <url>");
  }

  const url = args[0];
  const feed = await getFeedByUrl(url);
  if (!feed) {
    throw new Error(`Feed with URL '${url}' not found.`);
  }

  await deleteFeedFollow(user.id, feed.id);
  console.log(`User '${user.name}' has unfollowed '${feed.name}'.`);
}

function parseDuration(durationStr: string): number {
  const regex = /^(\d+)(ms|s|m|h)$/;
  const match = durationStr.match(regex);
  if (!match) throw new Error(`Invalid duration: ${durationStr}`);

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case "ms":
      return value;
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    default:
      return 0;
  }
}

async function scrapeFeeds() {
  const feed = await getNextFeedToFetch();
  if (!feed) {
    console.log("No feeds found to scrape.");
    return;
  }

  console.log(`Fetching feed: ${feed.name} (${feed.url})...`);
  await markFeedFetched(feed.id);

  try {
    const data = await fetchFeed(feed.url);
    console.log(`Found ${data.channel.item.length} posts:`);
    for (const item of data.channel.item) {
      await createPost(
        item.title,
        item.link,
        item.description || null,
        new Date(item.pubDate),
        feed.id,
      );
    }
  } catch (err) {
    console.error(`Error fetching ${feed.name}:`, err);
  }
}

async function handlerBrowse(cmdName: string, user: User, ...args: string[]) {
  const limit = args.length > 0 ? parseInt(args[0]) : 2;

  const postsList = await getPostsForUser(user.id, limit);

  if (postsList.length === 0) {
    console.log("No posts found. Try running the 'agg' command first!");
    return;
  }

  postsList.forEach((post) => {
    console.log(`--- ${post.title} ---`);
    console.log(`Feed: ${post.feedName} | Published: ${post.publishedAt}`);
    console.log(`Link: ${post.url}\n`);
  });
}

async function main() {
  const commands: CommandsRegistry = {};
  registerCommand(commands, "login", handlerLogin);
  registerCommand(commands, "register", handlerRegister);
  registerCommand(commands, "reset", handlerReset);
  registerCommand(commands, "users", handlerUsers);
  registerCommand(commands, "agg", handlerAgg);
  registerCommand(commands, "feeds", handlerListFeeds);

  registerCommand(commands, "addfeed", middlewareLoggedIn(handlerAddFeed));
  registerCommand(commands, "follow", middlewareLoggedIn(handlerFollow));
  registerCommand(commands, "following", middlewareLoggedIn(handlerFollowing));
  registerCommand(commands, "unfollow", middlewareLoggedIn(handlerUnfollow));
  registerCommand(commands, "browse", middlewareLoggedIn(handlerBrowse));

  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Error: Not enough arguments.");
    process.exit(1);
  }

  try {
    await runCommand(commands, args[0], ...args.slice(1));
    process.exit(0);
  } catch (err) {
    if (err instanceof Error) console.error(err.message);
    process.exit(1);
  }
}

main();

/*
npm run start register mariana (suhould succeed).
npm run start register mariana (should fail because the user already exists).
npm run start login mariana (should succeed).
npm run start login unknown (should fail because the user does not exist).
*/
