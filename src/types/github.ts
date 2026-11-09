export interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
  html_url: string;
  type: string;
}

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string; // e.g. "owner/repo"
  owner: GitHubUser;
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch: string;
}

export interface GitHubCommit {
  id: string;
  tree_id?: string;
  distinct?: boolean;
  message: string;
  timestamp: string;
  url: string;
  author: {
    name: string;
    email: string;
    username?: string;
  };
  committer?: {
    name: string;
    email: string;
    username?: string;
  };
  added?: string[];
  removed?: string[];
  modified?: string[];
}

export interface GitHubPushEvent {
  ref: string; // e.g. "refs/heads/main" or "refs/tags/v1.0.0"
  before: string;
  after: string;
  created: boolean;
  deleted: boolean;
  forced: boolean;
  base_ref: string | null;
  compare: string;
  commits: GitHubCommit[];
  head_commit: GitHubCommit | null;
  repository: GitHubRepository;
  pusher: {
    name: string;
    email?: string;
  };
  sender: GitHubUser;
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  state: 'open' | 'closed';
  locked: boolean;
  title: string;
  user: GitHubUser;
  body: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
  html_url: string;
  diff_url: string;
  merged: boolean;
  mergeable: boolean | null;
  comments: number;
  commits: number;
  additions: number;
  deletions: number;
  changed_files: number;
  draft?: boolean;
  head: {
    label: string;
    ref: string;
    sha: string;
    repo: GitHubRepository;
  };
  base: {
    label: string;
    ref: string;
    sha: string;
    repo: GitHubRepository;
  };
}

export interface GitHubPullRequestEvent {
  action:
    | 'opened'
    | 'closed'
    | 'reopened'
    | 'assigned'
    | 'unassigned'
    | 'review_requested'
    | 'review_request_removed'
    | 'ready_for_review'
    | 'converted_to_draft'
    | 'synchronize';
  number: number;
  pull_request: GitHubPullRequest;
  repository: GitHubRepository;
  sender: GitHubUser;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  user: GitHubUser;
  labels: Array<{ name: string; color: string; description?: string }>;
  state: 'open' | 'closed';
  locked: boolean;
  assignee: GitHubUser | null;
  assignees: GitHubUser[];
  comments: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  body: string | null;
  html_url: string;
  pull_request?: {
    url: string;
    html_url: string;
  };
}

export interface GitHubIssuesEvent {
  action:
    | 'opened'
    | 'edited'
    | 'deleted'
    | 'transferred'
    | 'pinned'
    | 'unpinned'
    | 'closed'
    | 'reopened'
    | 'assigned'
    | 'unassigned'
    | 'labeled'
    | 'unlabeled'
    | 'locked'
    | 'unlocked';
  issue: GitHubIssue;
  repository: GitHubRepository;
  sender: GitHubUser;
}

export interface GitHubComment {
  id: number;
  html_url: string;
  user: GitHubUser;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubIssueCommentEvent {
  action: 'created' | 'edited' | 'deleted';
  issue: GitHubIssue;
  comment: GitHubComment;
  repository: GitHubRepository;
  sender: GitHubUser;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  target_commitish: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  created_at: string;
  published_at: string | null;
  html_url: string;
  body: string | null;
  author: GitHubUser;
}

export interface GitHubReleaseEvent {
  action: 'published' | 'created' | 'edited' | 'deleted' | 'prereleased' | 'released';
  release: GitHubRelease;
  repository: GitHubRepository;
  sender: GitHubUser;
}

export interface GitHubWorkflowRun {
  id: number;
  name: string;
  head_branch: string;
  head_sha: string;
  event: string;
  status: 'completed' | 'in_progress' | 'queued';
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required' | null;
  workflow_id: number;
  html_url: string;
  run_number: number;
  created_at: string;
  updated_at: string;
  actor: GitHubUser;
}

export interface GitHubWorkflowRunEvent {
  action: 'completed' | 'requested' | 'in_progress';
  workflow_run: GitHubWorkflowRun;
  workflow: {
    id: number;
    name: string;
    path: string;
    state: string;
  };
  repository: GitHubRepository;
  sender: GitHubUser;
}

export interface GitHubStarEvent {
  action: 'created' | 'deleted';
  starred_at: string | null;
  repository: GitHubRepository;
  sender: GitHubUser;
}

export interface GitHubForkEvent {
  forkee: GitHubRepository;
  repository: GitHubRepository;
  sender: GitHubUser;
}

export interface GitHubPingEvent {
  zen: string;
  hook_id: number;
  hook: {
    type: string;
    id: number;
    name: string;
    active: boolean;
    events: string[];
  };
  repository?: GitHubRepository;
  sender: GitHubUser;
}
