/**
 * `buildPostTree` is the only branching/looping logic on the client, so it gets
 * the check. Run with `bun test`.
 */
import { describe, expect, test } from 'bun:test'
import { buildPostTree } from '../src/web/postTree'
import type { PostRow } from '../src/shared/types'

const post = (id: number, parentId: number | null): PostRow => ({
  id,
  threadId: 1,
  authorId: 1,
  parentId,
  body: `post ${id}`,
  createdAt: new Date(2026, 0, 1, 0, 0, id).toISOString(),
})

/** Flattens the tree back to ids in render order, parents before children. */
function order(nodes: ReturnType<typeof buildPostTree>): number[] {
  return nodes.flatMap((node) => [node.post.id, ...order(node.children)])
}

describe('buildPostTree', () => {
  test('returns the opening post as the only root', () => {
    const tree = buildPostTree([post(1, null)])
    expect(tree).toHaveLength(1)
    expect(tree[0]!.post.id).toBe(1)
    expect(tree[0]!.children).toHaveLength(0)
  })

  test('nests replies under their parent at any depth', () => {
    const tree = buildPostTree([post(1, null), post(2, 1), post(3, 2)])
    expect(order(tree)).toEqual([1, 2, 3])
    expect(tree[0]!.children[0]!.post.id).toBe(2)
    expect(tree[0]!.children[0]!.children[0]!.post.id).toBe(3)
  })

  test('keeps sibling order as given, not by id', () => {
    const tree = buildPostTree([post(1, null), post(3, 1), post(2, 1)])
    expect(tree[0]!.children.map((c) => c.post.id)).toEqual([3, 2])
  })

  test('promotes an orphaned reply to a root instead of dropping it', () => {
    // post 9 replies to a post that was deleted mid-flight.
    const tree = buildPostTree([post(1, null), post(9, 404)])
    expect(order(tree)).toEqual([1, 9])
    expect(tree).toHaveLength(2)
  })

  test('handles an empty thread', () => {
    expect(buildPostTree([])).toEqual([])
  })
})
