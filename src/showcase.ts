import { Showcase } from './render/showcase/Showcase';

/** Character showcase page (showcase.html): the cast on a turntable, for judging characters. */
const params = new URLSearchParams(location.search);
const show = new Showcase(document.getElementById('app')!, params);
show.start();

const $ = (id: string) => document.getElementById(id)!;
const label = () => {
  const s = show.state;
  $('who').textContent = s.who;
  $('anim').textContent = s.anim;
  $('view').textContent = s.view === 'face' ? 'face' : 'full body';
  $('expr').textContent = s.expression;
};
show.onChange = label;
label();
$('prev').addEventListener('click', () => show.next(-1));
$('next').addEventListener('click', () => show.next(1));
$('animBtn').addEventListener('click', () => show.cycleAnim());
$('viewBtn').addEventListener('click', () => show.toggleView());
$('exprBtn').addEventListener('click', () => {
  const list = show.expressions();
  show.setExpression(list[(list.indexOf(show.state.expression) + 1) % list.length]);
});

/** Test hook. */
Object.defineProperty(window, '__show', { get: () => ({ frames: show.frames, ...show.state }) });
