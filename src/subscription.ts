import {
  OutputSchema as RepoEvent,
  isCommit,
} from './lexicon/types/com/atproto/sync/subscribeRepos'
import { FirehoseSubscriptionBase, getOpsByType } from './util/subscription'

export class FirehoseSubscription extends FirehoseSubscriptionBase {
  async handleEvent(evt: RepoEvent) {
    if (!isCommit(evt)) return

    const ops = await getOpsByType(evt)

    // This logs the text of every post off the firehose.
    // Just for fun :)
    // Delete before actually using
    // for (const post of ops.posts.creates) {
    //   console.log(post.record.text)
    // }

    const postsToDelete = ops.posts.deletes.map((del) => del.uri)

    // Define an array of education-related terms to match
    const educationTerms = ['UKed', 'EduSky', 'GCSE', 'A-Level', 'A Level', 'TeachUK', 'EdTech'];

    // Create a regex pattern that matches any term in the array
    // The \b ensures we match whole words, and the 'i' flag makes it case-insensitive
    const termsPattern = new RegExp(`#?(${educationTerms.join('|')})\\b`, 'i');

    const postsToCreate = ops.posts.creates
      .filter((create) => {
        // only alf-related posts
        // return create.record.text.toLowerCase().includes('alf')

        // Check if post contains any of our education terms
        return termsPattern.test(create.record.text);
      })
      .map((create) => {
        // map alf-related posts to a db row
        return {
          uri: create.uri,
          cid: create.cid,
          indexedAt: new Date().toISOString(),
        }
      })

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
