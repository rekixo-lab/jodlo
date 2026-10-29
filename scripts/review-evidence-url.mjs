/** Only trusted JODLO GitHub PR/PR-comment references; never reviewer authentication. */
export function validJodloReviewUrl(url) {
  return typeof url==="string" &&
    /^https:\/\/github\.com\/rekixo-lab\/jodlo\/pull\/[1-9][0-9]{0,7}(?:#issuecomment-[1-9][0-9]*)?$/u.test(url);
}
