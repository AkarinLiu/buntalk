/**
 * Turns the flat `posts` list of a thread into the nested tree the UI renders.
 *
 * Kept out of the component so `Thread.vue` and `PostItem.vue` can share the
 * node type (Vue does not allow exports from `<script setup>`) and so the
 * ordering rules have one testable home:
 *   * siblings keep the API's `createdAt, id` order;
 *   * a reply whose parent is missing (deleted mid-flight) is promoted to a
 *     root rather than silently dropped.
 */
import type { PostRow } from '../shared/types'

export interface PostNode {
  post: PostRow
  children: PostNode[]
}

export function buildPostTree(posts: PostRow[]): PostNode[] {
  const nodes = new Map<number, PostNode>()
  for (const post of posts) nodes.set(post.id, { post, children: [] })

  const roots: PostNode[] = []
  for (const post of posts) {
    const node = nodes.get(post.id)
    if (!node) continue
    const parent = post.parentId === null ? undefined : nodes.get(post.parentId)
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}
