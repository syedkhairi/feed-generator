import {
  OutputSchema as RepoEvent,
  isCommit,
} from './lexicon/types/com/atproto/sync/subscribeRepos'
import { FirehoseSubscriptionBase, getOpsByType } from './util/subscription'
import axios from 'axios'

// Add this function to check relevance using LLM
async function isRelevantToUKEducation(text: string): Promise<boolean> {
  try {
    const response = await axios({
      method: 'post',
      url: 'https://llm.staffroom.chat/ollama/api/generate',
      headers: {
        'Authorization': `Bearer ${process.env.OPEN_WEB_UI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      data: {
        model: "gemma3:1b",
        prompt: `You are a helpful assistant. You will be given a text and you need to rate its relevance to UK education and schools and teachers. Please give a rating from 0 to 10 where 0 is not relevant at all and 10 is the most relevant to UK education. Don't make it too sensitive. Only respond with a number. I don't want explanation. Text: ${text}`,
        stream: false
      }
    });
    
    // Extract the relevance score (expecting just a number in the response)
    const relevanceScore = parseInt(response.data.response.trim(), 10);
    console.log(`Relevance score for post: ${relevanceScore}`);
    
    // Consider posts with score 6 or higher as relevant to UK education
    return relevanceScore >= 6;
  } catch (error) {
    console.error('Error checking relevance with LLM:', error);
    // In case of error, fall back to keyword matching
    return true;
  }
}

export class FirehoseSubscription extends FirehoseSubscriptionBase {
  async handleEvent(evt: RepoEvent) {
    if (!isCommit(evt)) return

    const ops = await getOpsByType(evt)

    const postsToDelete = ops.posts.deletes.map((del) => del.uri)
    
    // const plainTerms = [
    //   'GCSE', 'A-Level', 'TeachUK', 'EdTech', 'AQA', 
    //   'Edexcel', 'OCR', 'WJEC',
    //   'IB', 'BTEC', 'SATs', 'GCSEs', 
    // ];

    // Split the arrays for better control
    const ukEdHashtag = 'UKEd';
    const eduSkyHashtag = 'EduSky';
    
    // Create regex patterns with proper word boundaries
    const ukEdPattern = new RegExp(`#(${ukEdHashtag})\\b`, 'i');
    const eduSkyPattern = new RegExp(`#(${eduSkyHashtag})\\b`, 'i');
    
    // const plainTermsPattern = new RegExp(`\\b(${plainTerms.join('|')})\\b`, 'i');

    // const postsToCreate = ops.posts.creates
    //   .filter(async (create) => {
    //     // Check if post contains any of our education terms
    //     const text = create.record.text;
    //     const keywordFilteredPost = hashtagPattern.test(text) || plainTermsPattern.test(text);
    //     if (!keywordFilteredPost) {
    //       return false
    //     } else {
    //       // Check relevance using LLM
    //       console.log(`Checking relevance for post: ${text}`);
    //       const isRelevant = await isRelevantToUKEducation(text);
    //       return isRelevant;
    //     }
    //   })
    //   .map((create) => {
    //     return {
    //       uri: create.uri,
    //       cid: create.cid,
    //       indexedAt: new Date().toISOString(),
    //     }
    //   })
    
    const filteredPostsPromises = await Promise.all(ops.posts.creates.map(async (create) => {
      // Check if post contains any of our education terms
      const text = create.record.text;
      
      // If text contains #UKEd, immediately accept it
      if (ukEdPattern.test(text)) {
        console.log(`Post contains #UKEd, automatically including it`);
        return {
          uri: create.uri,
          cid: create.cid,
          indexedAt: new Date().toISOString(),
        };
      }
      
      // If text contains #EduSky, run it through the LLM
      if (eduSkyPattern.test(text)) {
        // Check relevance using LLM
        console.log(`Post contains #EduSky, checking relevance: ${text}`);
        const isRelevant = await isRelevantToUKEducation(text);
        return isRelevant ? {
          uri: create.uri,
          cid: create.cid,
          indexedAt: new Date().toISOString(),
        } : null;
      }
      
      // If it doesn't contain either hashtag, filter it out
      return null;
    }));
    
    const postsToCreate = filteredPostsPromises.filter(post => post !== null);

    if (postsToDelete.length > 0) {
      await this.db
        .deleteFrom('post')
        .where('uri', 'in', postsToDelete)
        .execute()
    }
    if (postsToCreate.length > 0) {
      await this.db
        .insertInto('post')
        .values(postsToCreate)
        .onConflict((oc) => oc.doNothing())
        .execute()
    }
  }
}
