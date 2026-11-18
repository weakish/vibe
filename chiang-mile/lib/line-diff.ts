export type DiffOp = {
  kind: 'equal' | 'insert' | 'delete'
  text: string
}

export function diffLines(before: string, after: string): DiffOp[] {
  const left = before.split('\n')
  const right = after.split('\n')
  const n = left.length
  const m = right.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        left[i] === right[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      out.push({ kind: 'equal', text: left[i] })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'delete', text: left[i] })
      i += 1
    } else {
      out.push({ kind: 'insert', text: right[j] })
      j += 1
    }
  }
  while (i < n) {
    out.push({ kind: 'delete', text: left[i] })
    i += 1
  }
  while (j < m) {
    out.push({ kind: 'insert', text: right[j] })
    j += 1
  }
  return out
}
