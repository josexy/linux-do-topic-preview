// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  findTopicLinkFromTarget,
  isSameTopicTarget,
  parseTopicIdentity,
  parseTopicUrl,
} from '../src/content/topic-matcher';

const ORIGIN = 'https://linux.do';

describe('topic-matcher', () => {
  it('parses valid same-origin Discourse topic URLs', () => {
    expect(parseTopicUrl('/t/topic/123456', ORIGIN)).toBe(
      'https://linux.do/t/topic/123456',
    );
    expect(parseTopicUrl('/t/my-cool-topic/98765/12?u=alice#post_12', ORIGIN)).toBe(
      'https://linux.do/t/my-cool-topic/98765/12',
    );
    expect(parseTopicUrl('https://linux.do/t/54321/', ORIGIN)).toBe(
      'https://linux.do/t/54321',
    );
  });

  it('rejects non-topic paths and cross-origin URLs', () => {
    expect(parseTopicUrl('/c/develop/4', ORIGIN)).toBeNull();
    expect(parseTopicUrl('/u/alice', ORIGIN)).toBeNull();
    expect(parseTopicUrl('/latest', ORIGIN)).toBeNull();
    expect(parseTopicUrl('https://other.site/t/topic/123', ORIGIN)).toBeNull();
    expect(parseTopicUrl('', ORIGIN)).toBeNull();
  });

  it('matches Discourse topic list title links and nested spans', () => {
    document.body.innerHTML = `
      <table>
        <tr class="topic-list-item">
          <td class="main-link">
            <span class="link-top-line">
              <a class="title raw-topic-link" href="/t/topic/456789">
                <span>测试一个 Topic 标题</span>
              </a>
            </span>
            <span class="topic-post-badges">
              <a class="badge-notification new-posts" href="/t/topic/456789/5">3</a>
            </span>
          </td>
        </tr>
      </table>
      <div class="post-body">
        <a href="/t/topic/456789">正文中的普通引用链接</a>
      </div>
    `;

    const titleSpan = document.querySelector('.raw-topic-link span');
    const matched = findTopicLinkFromTarget(titleSpan, ORIGIN);
    expect(matched).not.toBeNull();
    expect(matched?.url).toBe('https://linux.do/t/topic/456789');
    expect(matched?.title).toBe('测试一个 Topic 标题');

    // Unread badge counter should be excluded
    const badgeLink = document.querySelector('.badge-notification');
    expect(findTopicLinkFromTarget(badgeLink, ORIGIN)).toBeNull();

    // Arbitrary inline link inside post body should be excluded
    const bodyLink = document.querySelector('.post-body a');
    expect(findTopicLinkFromTarget(bodyLink, ORIGIN)).toBeNull();
  });

  it('extracts canonical topic identity and matches slug redirects', () => {
    expect(parseTopicIdentity('https://linux.do/t/topic/123456')).toEqual({
      origin: 'https://linux.do',
      topicId: '123456',
      postNumber: null,
    });
    expect(parseTopicIdentity('/t/real-slug/123456/18', ORIGIN)).toEqual({
      origin: 'https://linux.do',
      topicId: '123456',
      postNumber: '18',
    });
    expect(parseTopicIdentity('https://linux.do/latest')).toBeNull();

    // Slug redirect matches the same topic
    expect(
      isSameTopicTarget(
        'https://linux.do/t/topic/123456',
        'https://linux.do/t/actual-slug/123456',
      ),
    ).toBe(true);
    // Requesting topic without post number matches any scrolled post in same topic
    expect(
      isSameTopicTarget(
        'https://linux.do/t/topic/123456',
        'https://linux.do/t/actual-slug/123456/7',
      ),
    ).toBe(true);
    // Requesting a specific post number requires matching post number
    expect(
      isSameTopicTarget(
        'https://linux.do/t/topic/123456/9',
        'https://linux.do/t/actual-slug/123456/7',
      ),
    ).toBe(false);
    expect(
      isSameTopicTarget(
        'https://linux.do/t/topic/123456/9',
        'https://linux.do/t/actual-slug/123456/9',
      ),
    ).toBe(true);
    // Different topic IDs do not match
    expect(
      isSameTopicTarget(
        'https://linux.do/t/topic/123456',
        'https://linux.do/t/topic/654321',
      ),
    ).toBe(false);
  });
});
