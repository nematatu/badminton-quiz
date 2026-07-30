const LIMITS = { title: 80, description: 280, questions: 50, question: 300, option: 160, explanation: 500 };
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export function validateQuiz(input) {
  const title = clean(input?.title, LIMITS.title);
  const description = clean(input?.description, LIMITS.description);
  if (!title) throw Object.assign(new Error('title_required'), { status: 400 });
  if (!Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > LIMITS.questions) throw Object.assign(new Error('invalid_question_count'), { status: 400 });
  const questions = input.questions.map((item, position) => {
    const prompt = clean(item?.prompt, LIMITS.question);
    const explanation = clean(item?.explanation, LIMITS.explanation);
    const options = Array.isArray(item?.options) ? item.options.map(v => clean(v, LIMITS.option)) : [];
    const correctIndex = Number(item?.correctIndex);
    if (!prompt || options.length !== 4 || options.some(v => !v) || new Set(options.map(v => v.toLocaleLowerCase())).size !== 4 || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
      throw Object.assign(new Error(`invalid_question_${position + 1}`), { status: 400 });
    }
    return { prompt, explanation, options, correctIndex, position };
  });
  return { title, description, questions };
}

export function validateAnswers(input, total) {
  const answers = input?.answers;
  if (!Array.isArray(answers) || answers.length !== total || answers.some(v => !Number.isInteger(v) || v < 0 || v > 3)) throw Object.assign(new Error('invalid_answers'), { status: 400 });
  return answers;
}
