const snoowrap = require('snoowrap');
const config = require('./config.json');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// Destructure the required properties
const { userAgent, clientId, clientSecret, username, password } = config;

// Create a new snoowrap requester with OAuth credentials
const r = new snoowrap({
  userAgent: userAgent,
  clientId: clientId,
  clientSecret: clientSecret,
  username: username,
  password: password
});

const SUBREDDIT = 'MyNameIsEarlFans';
const SHOW_ID = '678';
const STATE_FILE = path.join(__dirname, 'episodeState.json');
const SEEN_CONTENT_FILE = path.join(__dirname, 'seenContent.json');

// Add this near your other constants
const WATCH_SUBREDDITS = ['MyNameIsEarlFans']; // Add more subreddits as needed
const KEYWORDS = ['earl', 'karma', 'list', 'crabman', 'good bot', '20th', 'twentieth', 'anniversary']; // Keywords to watch for

// Function to check if a string contains any of the keywords
function containsKeywords(text) {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  return KEYWORDS.some(keyword => lowerText.includes(keyword.toLowerCase()));
}

// Function to read previously seen content
function readSeenContent() {
  try {
    if (fs.existsSync(SEEN_CONTENT_FILE)) {
      const data = JSON.parse(fs.readFileSync(SEEN_CONTENT_FILE, 'utf8'));
      // Convert the arrays back to Sets for faster lookups
      return {
        posts: new Set(data.posts || []),
        comments: new Set(data.comments || [])
      };
    } else {
      // Create default empty file if it doesn't exist
      const defaultData = { posts: [], comments: [] };
      fs.writeFileSync(SEEN_CONTENT_FILE, JSON.stringify(defaultData, null, 2));
      return { posts: new Set(), comments: new Set() };
    }
  } catch (error) {
    console.error('🐢 Error reading seen content file:', error);
    return { posts: new Set(), comments: new Set() };
  }
}

// Function to save seen content
function saveSeenContent(seenPosts, seenComments) {
  try {
    // Convert Sets to arrays for JSON storage
    const data = {
      posts: Array.from(seenPosts),
      comments: Array.from(seenComments)
    };
    fs.writeFileSync(SEEN_CONTENT_FILE, JSON.stringify(data, null, 2));
    console.log(`🐢 Saved ${seenPosts.size} posts and ${seenComments.size} comments to tracking file`);
  } catch (error) {
    console.error('🐢 Error saving seen content:', error);
  }
}

// Initialize Sets with data from file (replace existing declarations)
const { posts: previouslySeenPosts, comments: previouslySeenComments } = readSeenContent();

// Function to monitor new submissions in specified subreddits
function monitorSubreddits() {
  console.log(`🐢 Starting to monitor r/${WATCH_SUBREDDITS.join(', ')} for new posts...`);

  // Track the last check time
  let lastCheckTime = Date.now();

  // Poll for new submissions every 59 seconds, but avoid the critical minute
  setInterval(async () => {
    const now = new Date();
    // Skip this check if we're close to the scheduled cron job time (Saturday 18:59 UTC)
    if (now.getDay() === 6 && now.getHours() === 18 && (now.getMinutes() === 58 || now.getMinutes() === 59)) {
      console.log('🐢 Skipping post check to prioritize scheduled episode post');
      return;
    }
    
    console.log('🐢 ' + now.toLocaleString() + ': Checking for new posts...');
    try {
      // Get the latest posts directly
      const subreddit = r.getSubreddit(WATCH_SUBREDDITS.join('+'));
      const latestPosts = await subreddit.getNew({limit: 10});

      const currentTime = Date.now();

      for (const post of latestPosts) {
        if (post.author.name === 'MrTurtleBot') continue; // Ignore own posts
        if (post.author.name === 'AutoModerator') continue; // Ignore AutoModerator posts
        if (post.title.includes('removed')) continue; // Ignore removed posts
        if (post.title.includes('deleted')) continue; // Ignore deleted posts
        const postCreated = post.created_utc * 1000; // Convert to milliseconds

        // Only process posts created since our last check
        if (postCreated > lastCheckTime) {
          // Find which keyword(s) matched
          const turtleRegExp = /(turtle(.*)?knocked\W*over\W*((the|a|that|)\W*)?candle\b)|(turtle(.*)?knocked\W*((the|a|that|)\W*)?candle\W*over\b)/i;
          const turtleMatchTitle = post.title.match(turtleRegExp);
          const turtleMatchBody = post.selftext ? post.selftext.match(turtleRegExp) : null;
          const turtleMatch = turtleMatchTitle || turtleMatchBody;

          if (turtleMatch && !previouslySeenPosts.has(post.id)) {
            console.log(`🐢 [monitorSubreddits ${new Date().toLocaleString()}]: Found matching post: "${post.title}"`);

            console.log(`🐢 [monitorSubreddits: ${new Date().toLocaleString()}]: Replied to post by u/${post.author.name}\nDodge definitely knocked over that candle.`);
            // Mark as seen
            previouslySeenPosts.add(post.id);
            saveSeenContent(previouslySeenPosts, previouslySeenComments);
            return post.reply(`Dodge definitely knocked over that candle.`);
          }
          const matchedKeywords = findMatchedKeywords(post.title, post.selftext);

          if (matchedKeywords.length > 0) {
            console.log(`🐢 [monitorSubreddits ${new Date().toLocaleString()}]: Found matching post: "${post.title}" with keywords: ${matchedKeywords.join(', ')}`);

            // Only respond if we haven't seen this post before
            if (!previouslySeenPosts.has(post.id)) {
              // Take action - pass the matched keywords
              await respondToPost(post, matchedKeywords);

              // Mark as seen
              previouslySeenPosts.add(post.id);
              saveSeenContent(previouslySeenPosts, previouslySeenComments);
            } else {
              console.log(`🐢 Already processed post ${post.id}, skipping`);
            }
          }
        }
      }

      // Update the last check time
      lastCheckTime = currentTime;

    } catch (error) {
      console.error('🐢 Error monitoring subreddits:', error);
    }
  }, 59000); // Check every 59 seconds
}

// New function to find all matched keywords
function findMatchedKeywords(title, selftext) {
  const matchedKeywords = [];
  const titleLower = title ? title.toLowerCase() : '';
  const textLower = selftext ? selftext.toLowerCase() : '';

  KEYWORDS.forEach(keyword => {
    const keywordLower = keyword.toLowerCase();
    if (titleLower.includes(keywordLower) || textLower.includes(keywordLower)) {
      matchedKeywords.push(keyword);
    }
  });

  return matchedKeywords;
}

// Modified version for respondToPost function
async function respondToPost(post, matchedKeywords) {
  try {
    // Customize reply based on the matched keywords
    let keywordMention = '';

    if (matchedKeywords.length === 1) {
      keywordMention = `you mentioned "${matchedKeywords[0]}"`;
    } else {
      const lastKeyword = matchedKeywords.pop();
      keywordMention = `you mentioned ${matchedKeywords.join(', ')} and ${lastKeyword}`;
    }

    let reply = `Hello! I noticed ${keywordMention}! Nice!`;

    if (matchedKeywords === '20th' || matchedKeywords === 'twentieth' || matchedKeywords === '20' || matchedKeywords === 'twenty' || matchedKeywords === 'anniversary') {
      reply = `Hello! I noticed ${keywordMention}! I'm Mr. Turtle, a bot that helps with our My Name Is Earl 20th anniversary discussion series!`;
    }
    else if (matchedKeywords === 'earl') {
      reply = 'Earl is a great character!';
    }
    else if (matchedKeywords === 'karma') {
      reply = 'Karma is a central theme in the show!';
    }
    else if (matchedKeywords === 'list') {
      reply = 'The list is iconic!';
    }
    else if (matchedKeywords === 'crabman') {
      reply = 'Crabman is a fan-favorite!';
    }
    else {
      if (Math.random() < 0.9) return; // 90% chance to skip replying
      else {
        // give it a thumbs up!
        // console.log(`🐢 [respondToPost: ${new Date().toLocaleString()}]: Upvoting post by u/${post.author.name}`);
        console.log(`🐢 [respondToPost: ${new Date().toLocaleString()}]: Ignoring post by u/${post.author.name}, so I don't bother everyone too much.`);
        // await post.upvote();
      }
    }

    await post.reply(reply);
    console.log(`🐢 [respondToPost: ${new Date().toLocaleString()}]: Replied to post by u/${post.author.name}\n${reply}`);

    // Save immediately after processing
    saveSeenContent(previouslySeenPosts, previouslySeenComments);
  } catch (error) {
    console.error('🐢 Error responding to post:', error);
  }
}

// Function to monitor comments in specified subreddits
function monitorComments() {
  console.log(`🐢 Starting to monitor comments in r/${WATCH_SUBREDDITS.join(', ')}...`);

  // Track the last check time for comments
  let lastCommentCheckTime = Date.now();

  // Poll for new comments every 120 seconds
  setInterval(async () => {
    const now = new Date();
    // Skip this check if we're close to the scheduled cron job time (Saturday 18:59)
    if (now.getDay() === 6 && now.getHours() === 18 && (now.getMinutes() === 58 || now.getMinutes() === 59)) {
      console.log('🐢 Skipping comments check to prioritize scheduled episode post');
      return;
    }
  
  console.log('🐢 ' + new Date().toLocaleString() + ': Checking for new comments...');
    try {
      // Get the latest comments directly
      const subreddit = r.getSubreddit(WATCH_SUBREDDITS.join('+'));
      const latestComments = await subreddit.getNewComments({limit: 25});

      const currentTime = Date.now();

      for (const comment of latestComments) {

        if (comment.author.name === 'MrTurtleBot') continue; // Ignore own comments
        if (comment.author.name === 'AutoModerator') continue; // Ignore AutoModerator comments
        if (comment.body.includes('removed')) continue; // Ignore removed comments
        if (comment.body.includes('deleted')) continue; // Ignore deleted comments


        const commentCreated = comment.created_utc * 1000; // Convert to milliseconds

        // Only process comments created since our last check
        if (commentCreated > lastCommentCheckTime) {

        console.log('🐢 comment.author.name:', comment.author.name);
        console.log('🐢 comment.id:', comment.id);
        console.log('🐢 comment.body:', comment.body);
        console.log('🐢------------------------');
        console.log('🐢 utc', new Date().toLocaleString())
        console.log('------------------------🐢');

          const turtleRegExp2 = /(turtle(.*)?knocked\W*over\W*((the|a|that|)\W*)?candle\b)|(turtle(.*)?knocked\W*((the|a|that|)\W*)?candle\W*over\b)/i;
          const turtleMatch2 = comment.body.match(turtleRegExp2);
          if (turtleMatch2 && !previouslySeenComments.has(comment.id)) {
            console.log(`🐢 [monitorSubreddits ${new Date().toLocaleString()}]: Found matching comment: "${comment.body}"`);

            // Take action - reply to the comment
            console.log(`🐢 [monitorComments: ${new Date().toLocaleString()}]: Replied to comment by u/${comment.author.name}\nDodge definitely knocked over that candle.`);
            if (!previouslySeenComments.has(comment.id)) {
            // Mark as seen
            previouslySeenComments.add(comment.id);
            saveSeenContent(previouslySeenPosts, previouslySeenComments);
            return comment.reply(`Dodge definitely knocked over that candle.`);
            }
          }

          // Check for keywords in comment body
          const matchedKeywords = findMatchedKeywords('', comment.body);

          if (matchedKeywords.length > 0) {
            console.log(`🐢 [monitorComments: ${new Date().toLocaleString()}]: Found matching comment: "${comment.body.substring(0, 50)}" with keywords: ${matchedKeywords.join(', ')}`);

            // Only respond if we haven't seen this comment before
            if (!previouslySeenComments.has(comment.id)) {
              // Take action - reply to the comment
              await respondToComment(comment, matchedKeywords);

              // Mark as seen
              previouslySeenComments.add(comment.id);
              saveSeenContent(previouslySeenPosts, previouslySeenComments);
            } else {
              console.log(`🐢 Already processed comment ${comment.id}, skipping`);
            }
          }
        }
      }

      // Update the last check time
      lastCommentCheckTime = currentTime;

    } catch (error) {
      console.error('🐢 Error monitoring comments:', error);
    }
  }, 61000); // Check every 61 seconds
}

// TODO: Do not do the general reply. Just respond to certain complete messages.

// Modified version for respondToComment function
async function respondToComment(comment, matchedKeywords) {
  // console.log(`🐢 comment:`, comment);
  try {
    if (comment.body.match(/^hey(,|) crabman('|)s turtle(.|!|\?|)$/i)) {
      let reply = `Hey Earl.`;
      console.log(`🐢 [respondToComment: ${new Date().toLocaleString()}]: Replied to comment by u/${comment.author.name}\n${reply}`);
      return comment.reply(reply);
    }
    if (comment.body.match(/good bot/i)) {
      let reply = 'Thanks! Got any arugula?';
      console.log(`🐢 [respondToComment: ${new Date().toLocaleString()}]: Replied to comment by u/${comment.author.name}\n${reply}`)
      return comment.reply(reply);
    }

    // Customize reply based on the matched keywords
    let keywordMention = '';

    if (matchedKeywords.length === 1) {
      keywordMention = `you mentioned "${matchedKeywords[0]}"`;
    } else {
      const lastKeyword = matchedKeywords.pop();
      keywordMention = `you mentioned ${matchedKeywords.join(', ')} and ${lastKeyword}`;
    }

    let reply = `Hello! I noticed ${keywordMention}! Nice!`;


    if (matchedKeywords === '20th' || matchedKeywords === 'twentieth' || matchedKeywords === 'anniversary') {
      reply = `Hello! I noticed ${keywordMention}! I'm Mr. Turtle, a bot that helps with our My Name Is Earl 20th anniversary discussion series!`;
    }
    else if (matchedKeywords === 'earl') {
      reply = 'Earl is a great character! Do you have a favorite episode?';
    }
    else if (matchedKeywords === 'karma') {
      reply = 'Karma is a central theme in the show! What are your thoughts on it?';
    }
    else if (matchedKeywords === 'list') {
      reply = 'The list is iconic! What’s your favorite item on it?';
    }
    else if (matchedKeywords === 'crabman') {
      reply = 'Crabman is a fan-favorite! Do you have a favorite moment with him?';
    }
    else {
      // TODO: return out 90% of the time here
      if (Math.random() < 0.9) return; // 90% chance to skip replying
      else {
        // give it a thumbs up!
        // console.log(`🐢 [respondToComment: ${new Date().toLocaleString()}]: Upvoting comment by u/${comment.author.name}`);
        // await comment.upvote();
        console.log(`🐢 [respondToComment: ${new Date().toLocaleString()}]: Ignoring comment by u/${comment.author.name}, so I don't bother everyone.`);
      }
    }

    await comment.reply(reply);
    console.log(`🐢 [respondToComment: ${new Date().toLocaleString()}]: Replied to comment by u/${comment.author.name}\n${reply}`);

    // Save immediately after processing
    saveSeenContent(previouslySeenPosts, previouslySeenComments);
  } catch (error) {
    console.error('🐢 Error responding to comment:', error);
  }
}

// Function to read the current state
function readState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const tData = fs.readFileSync(STATE_FILE, 'utf8');
      console.log('tData',tData);
      return JSON.parse(tData);
    } else {
      // Default state if file doesn't exist
      const defaultState = { currentSeason: 1, currentEpisode: 0 };
      console.log('created state file');
      fs.writeFileSync(STATE_FILE, JSON.stringify(defaultState, null, 2));
      return defaultState;
    }
  } catch (error) {
    console.error('🐢 Error reading state file:', error);
    return { currentSeason: 1, currentEpisode: 0 };
  }
}

// Function to save the current state
function saveState(season, episode) {
  try {
    const state = { currentSeason: season, currentEpisode: episode };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log(`🐢 State updated: Season ${season}, Episode ${episode}`);
  } catch (error) {
    console.error('🐢 Error saving state:', error);
  }
}

// Function to format date to MM-DD-YYYY
function formatDate(dateString) {
  const date = new Date(dateString);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${month}-${day}-${year}`;
}

// Modified Reddit posting code
async function postNextEpisode() {
  try {
    // Read the current state
    const state = readState();

    // Fetch all episodes
    const response = await axios.get(`https://api.tvmaze.com/shows/${SHOW_ID}/episodes`);
    const allEpisodes = response.data;

    // Sort episodes by season and episode number
    allEpisodes.sort((a, b) => {
      if (a.season !== b.season) return a.season - b.season;
      return a.number - b.number;
    });

    // Find the next episode
    const nextEpisode = allEpisodes.find(ep =>
      (ep.season > state.currentSeason) ||
      (ep.season === state.currentSeason && ep.number > state.currentEpisode)
    );

    if (!nextEpisode) {
      console.log('🐢 No more episodes to post - end of series reached');
      return;
    }

    // Create the post
    const title = `Episode Discussion: ${nextEpisode.name} (S${nextEpisode.season}E${nextEpisode.number})`;
    const body = `
**My Name Is Earl - 20th Anniversary Rewatch**

## S${nextEpisode.season}E${nextEpisode.number}: ${nextEpisode.name}

📅 **Original Air Date:** ${formatDate(nextEpisode.airdate)}

📝 **Summary:** ${nextEpisode.summary.replace(/<\/?[^>]+(>|$)/g, "")}

---

*This is part of our weekly episode discussion series for the show's 20th anniversary.*
`;

    // Post to Reddit and capture the submission object
    const submission = await r.getSubreddit(SUBREDDIT).submitSelfpost({ title, text: body });
    console.log(`🐢 Posted to r/${SUBREDDIT}: ${title}`);

    // Try to pin the post, but handle errors gracefully
    try {
      await submission.sticky({ num: 1 });
      console.log('🐢 Post has been pinned to the top of the subreddit');
    } catch (pinError) {
      console.log('🐢 Note: Could not pin post - bot account needs moderator permissions');
    }

    // Update the state with the episode we just posted
    saveState(nextEpisode.season, nextEpisode.number);

  } catch (error) {
    console.error('🐢 Error posting episode:', error);
  }
}

// Function to initialize or reset the state
function setStartingPoint(season, episode) {
  saveState(season, episode);
  console.log(`🐢 Starting point set to Season ${season}, Episode ${episode}`);
}

// Schedule weekly posts (e.g., every Saturday at 18:59 UTC, which is 1:59 PM CST, and 7:59 PM in Manchester UK)
// Adjust the cron expression as needed for your timezone
cron.schedule('59 18 * * 6', () => {
  // Use setImmediate to give this task higher priority in the event loop
  setImmediate(() => {
    console.log('🐢 Running scheduled episode post...' + new Date().toLocaleString());
    postNextEpisode();
  });
});

console.log('🐢 ... MrTurtleBot is crawling!');

// Uncomment these lines to test/manually control the bot
// setStartingPoint(1, 0);  // Set starting point (will post S1E1 next)
// postNextEpisode();       // Post immediately instead of waiting for schedule

// Start both monitoring functions
monitorSubreddits();
setTimeout(() => {
  monitorComments();
}, 10000);

// Save seen content every 5 minutes
setInterval(() => {
  saveSeenContent(previouslySeenPosts, previouslySeenComments);
}, 5 * 60 * 1000);

/**
 * ## How to use this script:

1. The first time you run it, use `setStartingPoint(1, 0)` to initialize the state (this will start with Season 1, Episode 1)
2. Run `postNextEpisode()` for your first post or wait for the scheduled time
3. The bot will automatically track which episode it last posted
4. It will post one episode per week on Mondays at 9 AM (you can customize this schedule)

## Key features:

- Maintains a simple state file to track the current episode
- Posts episodes in sequence regardless of air date
- Includes a formatted body with the episode information
- Uses cron to schedule regular weekly posts
- Allows you to set a specific starting point for the series


## Cron Schedule for Weekly Posts

This line of code sets up an automated task using cron scheduling in a JavaScript application. The `cron.schedule()` function takes two parameters: a cron expression and a callback function.

The cron expression `'0 9 * * 1'` specifies exactly when this task should run:
- `0` - At the 0th minute (top of the hour)
- `9` - At the 9th hour (9 AM)
- `*` - Every day of the month
- `*` - Every month
- `1` - Monday (in cron syntax, 1 represents Monday)

So this schedules a task to run every Monday at 9:00 AM precisely. The arrow function `() => {` that follows would contain the code that will execute at that time - presumably code that creates and publishes weekly posts, though that implementation isn't shown in the selection.

This is a common pattern in JavaScript applications that need to perform regular, scheduled tasks like sending newsletters, posting content, or running maintenance operations.

 */
