/**
 * «The First Lantern» — the seven cantos, verbatim engine data (design §5: the
 * desk's first book; Unsealing §6: story is engine-side world-fiction, so a
 * zero-pack build keeps its epic). TRANSCRIBED, never edited: cantos.test.ts
 * fails on any byte of drift from docs/story/the-first-lantern.md. Fix drift by
 * re-transcribing FROM the doc — the doc is canon; this file is a copy.
 */
export interface Canto {
  id: string;
  roman: string;
  title: string;
  body: string;
}

export const CANTOS: ReadonlyArray<Canto> = [
  {
    id: 'canto-1',
    roman: 'I',
    title: 'The Speaking',
    body: `Before the world, there was nothing to forget.

Hold that a moment; the whole tale turns on it. No loss, no fading, no name gone missing in the night — not because all was safe, but because nothing at all had yet been said.

Then came the Speaking.

Whose voice it was, the tellers do not agree, and the disagreement is old and friendly. Some say a voice above the sky; some, a voice under the roots. The tellers of the wood, who are our tellers tonight, give the kindest answer and the oldest: the world said itself — the way a fire, given one spark, says the rest of the burning on its own.

However it was, this much every keeper holds: the world was spoken, not built. No hammer touched it. It was said, the way a promise is said, and it stood, because saying is the strongest standing there is.

Every true thing is a spoken line. The river is a line, long and silver and glad to run downhill. The wren is a line, short and quick, with a flourish at the end. Moss is a line said slowly. The law of falling — that what is dropped comes down, faithfully, every time — is a line so deep the world does not remember learning it. Mountains, mornings, the weight of an apple, your own name: lines, lines, lines. The Speaking was one breath long, and in that one breath everything true was said once, perfectly, and for the first time.

The tellers of the wood add one thing more, and we keep it because it is ours: the wren was said first, because someone had to be listening — a saying wants a hearer, or what is it for? If that is wrong, it is wrong in the right direction, and the wrens have never once complained.

Now, a word you must have before we go on. The sum of all held lines — all the true things still carried in living breath — is called the Ledger. Not a book; no book was ever big enough, and anyway, as this tale will teach us dearly, a page is not a keeping. The Ledger is a covenant, four words long, and it runs both ways: *what is kept, keeps.* Hold the river's line, and the river runs. The world holds together exactly as well as its lines are held — no better, no worse. There has never been any other arrangement.

The deepest lines — the first-said, the ones all later lines lean upon — have been held so long they have gone to weld. A weld is a line past all danger: the law of falling, the roundness of rain. No single breath carries them; the whole world does. They are the beams of the house. Remember the welds. In a grey hour far from here, they will be the reason there is still a morning.

And then, for a time without measure — the measures being all new themselves — the world lay still and entire. Dew stood on the grass and remembered being dew. The rivers ran their names. Nothing needed tending, for nothing had begun to be forgotten; there were no keepers, because nothing yet wanted keeping. The world was young, and whole, and holding its breath.

Remember that too. It does not come again in this tale.

> *Say the river, and the river runs;*
> *say the wren, and the wren takes wing.*
> *One breath began us, moss and mountain:*
> *what was spoken has to sing.*
> *Hold the line, oh, hold the line —*
> *the world is words, in the keeping of tongues.*`,
  },
  {
    id: 'canto-2',
    roman: 'II',
    title: 'The First Forgetting',
    body: `Then the world breathed out.

No one marked the day the weather turned, and that is not carelessness: the day itself was among the first things taken.

It did not come as an army comes. Nothing marched; nothing burned. It came as a season comes — mist along the low ground at dusk, a greyness in the middle distance that did not lift by noon. People said: a long autumn. Then: a hard winter. Then spring did not so much fail to come as fail to be mentioned, and folk stopped speaking of the weather at all — which was the worst thing they could have stopped doing.

For the grey was the Fade, and the Fade is forgetting, given weather. It is not a wolf, though it was hunted like one; not a curse, though it was cursed at length. It is the Speaking's one breath going out again — slow, even, patient as tide — and it takes, always and only, the unheld lines first.

A stream ran past a hamlet in the low hills: quick water, good for cress, with a name the children had given it. The children grew. The name went a long while unsaid. And one grey morning it was nowhere — not mislaid, but gone from every head at once, like a candle out in a shut room. The tale cannot tell you the name, and that is the tale: the name is not in it because the name is not anywhere. First the name went. Then the cress. Then the stream. There is a smooth dry fold in those hills to this day, shaped exactly like missing water.

That was the pattern, learned slowly and at cost: first the name, then the thing. The unsaid edges went first — third verses of songs, middles of old roads, a star that had been the point of a story nobody told anymore. The grey came on like damp in a wall: no day's difference, every year's difference.

And there was no one to fight — grief with no enemy standing behind it. A man stood all night with his grandfather's boar-spear at the field's edge where the mist stood; the mist did not advance, and did not retreat, and did not care; he came home at dawn wet through, having stabbed weather. A rich valley raised a wall about itself; the mist did not mind the wall. Mist does not. People shouted questions into the fog and got nothing — and mark that nothing: everything else in the world answers somehow. Only the Fade answers no question, having no line of its own. It is the absence of a line, arriving.

But those grey years taught, to any who watched, a strange lesson with sunrise hidden in it: the things still said, held. The ford stayed where the old ferryman worked it — he sang the same worn crossing-song every trip, morning and evening, because his mother had sung it, and hers before that. All along that river the banks went vague; his stretch stayed water — brown, cold, entirely certain of itself. Folk called him lucky. He said the song was lucky. Both were nearly right. The soup a grandmother made and named every seventh day: held. The pattern lay plain for anyone with the wit to read it — *what is spoken stays* — but grief is loud and patterns are quiet, and for a long while all anyone did with the lesson was huddle nearer the hearths and talk, hoarding the sound of held lines against the grey outside the shutters.

That was not a craft yet; it was only clutching. But every craft begins somewhere, and this one was about to begin — with tallow, a wick-trimmer, and one pair of ordinary hands.

> *We lost the name of the little stream.*
> *We did not feel it go.*
> *The grey came soft as a turning season,*
> *quiet as first snow.*
> *What no one says, the weather takes —*
> *and we did not say. And we did not know.*`,
  },
  {
    id: 'canto-3',
    roman: 'III',
    title: 'The Lantern-Wright',
    body: `By that same ford there lived a tinker.

Every hamlet had one: the mender — kettles, hinges, and above all lamps, for folk were unwilling to sit the grey evenings in the dark. The tinker asked little and was liked the way a door is liked: used daily, praised never. Kindly, practical, and underestimated — set that down as the whole description. For reasons that will grieve us presently, no other description survives.

One evening the tinker sat late over a mended ferry-lamp, testing the wick. The ferryman was abed with winter in his chest, the crossing-song had not been sung since morning, and the night felt thin. The tinker, who had heard that song every morning and evening of a whole life, missed it the way you miss a clock's tick — by the shape of the silence. And so, for company, leaning close to trim the wick, the tinker sang it: low, half to themself, the whole worn line of it, into the little fire.

The flame stood up.

It did not flare, as oil flares. It steadied. It turned a colour the tinker had no name for and you have seen — a gold with morning in it — and the thread of mist under the door drew back the width of a hand, quietly, like a guest who understands the room is taken.

It held for a grain — the small while one grain takes to fall in a sandglass. Then another. Then all evening. By morning — the ferryman's daughter sang the crossing, and the river stayed a river — the tinker had understood three things.

First: a line spoken into a wick holds its glow a while. Not forever — a while. The light is the line's own warmth, the warmth of a true thing in the act of being meant; keepers after named it the Glow. It is the light in a window that tells you, from the road, that the room behind it is loved.

Second: only held lines would do. A lie did nothing; the flame sat unchanged. A line read cold off a page, unmeant, did nothing. But any true line truly held — a song worn smooth by two hundred years of crossings, the name of a wife ten years dead and said daily since — made the flame stand up golden and the grey step back. The light cared only that the line was held, never how great it was.

Third — and this the tinker held hardest — the glow must be fed. It faded by grains, gentle as dusk, and no cleverness of glass or oil would fix it in place. *Light is not kept,* the tinker would say later, in the doorways of a hundred hamlets. *Light is fed.* A lantern is not a jar for keeping light in. A lantern is a mouth.

So the tinker became the Lantern-Wright — coined as a tease, worn into honor. The Wright made lanterns as no one had made them: not jars but little hearths, wicks woven to take a spoken line and hold its glow the night through, a door in the glass sized exactly for a whisper. Folk laughed at the talking-lamps — until a grey thick as wool took two unsaid lanes in one night, and the street where a fed lantern stood stayed a street. It is remarkable how quickly laughter can learn.

The Wright gave the lanterns away. Mark it: gave. The finest craft of the age rolled off a peddler's cart for nothing, and the Wright asked in payment only the feeding — that the taker speak a held line into the wick at dusk, teach their children the same, and never let the lantern go a night unfed. At the crossroads the Wright raised braziers: lanterns too big to carry, so no traveler need cross the dark unlit; whoever fed one lit the road for every stranger behind. Some of those braziers burn yet.

Once — the tale is sure of this — a lord came with silver enough to buy the whole ford, wanting a lamp that would hold its light forever. No feeding, no tending; light locked safe the way treasure is locked behind iron. The Wright looked at him a long grain, with no mockery, only a kind of sorrow arriving early. "You are asking me for a lamp you may stop loving. I will not make one. And I am sorry for you, for you will not stop asking." Remember the lord. He is not the last in this tale to want that lamp.

The Wright grew old on the roads. Toward the end there was an apprentice — a ferryman's granddaughter from the old ford, quiet, quick-handed, who trimmed a wick so the flame took the line clean on the first breath. The Wright taught her all of it, and when the teaching was done, set the first lantern in her hands — the tin one, the ferry-lamp of that first night, mended until it was more mending than metal. "Take it. It knows your voice by now." Then the Wright went on down the road, because light was wanted everywhere and the evenings were long.

The Wright died as tinkers die: on the road between two mendings, at a hearth that was not theirs, among folk who knew its maker only as Wright. A quiet death, after a long supper. The tale does not weep here, so neither will we.

But when they went to cut the stone, they found that no one had the name.

Not the hearth-folk. Not the ford. Not even the apprentice. Fifty years of evenings the Wright had spent feeding other people's lines — streams, stars, strangers' dead — and never once asked a single soul to hold a line back for them. Modesty, or forgetfulness, or perhaps the Wright never thought of themself as a thing that could be lost; the tale does not know. The Fade knew. The name had gone unheld past all recovery, and no one had felt it go. You know the mark by now.

They cut a lantern into the stone, having nothing else to cut. It was the right choice, and it was not enough; both are true, and neither cancels the other.

If ever you find the name — in the corner of some old letter, in a dream, in the pause after a song — say it aloud. Do not stop to wonder whether you believe. There is a flame that has waited a long time for that particular feeding.

After the blank stone came the custom of being known by the work: Wright, Keeper, Clerk, Warden, Factor, Gatewright. Not because names had stopped mattering — because they had started. *Let the work be the name,* the first keepers said; *the work is a line the whole world helps to hold.* Hear pride in those plain titles if you like. Hear mourning first. Every work-name in this tale is a small stone with a lantern on it.

> *Light is not kept; light is fed.*
> *"Speak to the wick" is all they said.*
> *We kept the lanterns. We kept the flame.*
> *We kept the teaching, word for word.*
> *All of it held but the one thing unsaid —*
> *we remember the lanterns. Forgive us the name.*`,
  },
  {
    id: 'canto-4',
    roman: 'IV',
    title: 'The Oath of the Wellspring',
    body: `The apprentice took the road with the first lantern and her grief, which weighed more.

She walked nowhere in particular; that is how such walking goes. She fed the lantern each dusk, the feeding being owed, and owed things steady the feet. South, because the land leaned south; then wherever the next valley led; and so — grief navigating better than it is given credit for — she came at dusk to the wellspring.

By daylight you would not have marked it: a pool in a clearing of old trees, rimmed with stones no mason laid. But as the sky went to violet the water came up bright — softly, from below, gold rising through it in slow threads like cream stirred backward — until the whole pool stood full of steady light in the dark clearing, and made no sound about it at all.

She stayed three days trying to understand, and the water was patient, water having nowhere better to be. What she worked out is what keepers hold still: the wellspring is where the renewed things return. Every line anywhere spoken true kindles its little Glow, and the Glow runs down through the hidden seams of the world, as rain goes down through chalk, and gathers, and rises again here — brightest at dusk, because dusk is when the world does most of its remembering. She had found where every kept thing comes home. And she had come, as you will have guessed, to ask for one thing back.

On the fourth evening she knelt and asked the water for the Wright's name.

The water gave her back her own face, the lantern's flame over her shoulder, and the first stars. Not as refusal — the spring refuses nothing. It is a returning-place, not a finding-place: what rises is what was sent down, and the name had never once been sent. She knelt a long time anyway, the cold coming up through her knees, indifferent and clarifying. And somewhere in that kneeling she passed — as some griefs do, not ending, but turning — from *what have I lost* to *what am I still holding.*

She stayed the winter, trimming the lantern's wick each evening whether it wanted it or not, and found — a small discovery, held ever since — that a line spoken over the water came back easier the next dusk, and easier the dusk after: the spring remembered with you; what you tended at its edge, it took a share in tending. *Tomorrow's lantern lights easier,* she said — a plain way to say it, but she was a plain woman, and it has never needed saying better.

And at winter's end, at dusk, kneeling at the rim with the fed lantern beside her, she swore.

She had thought first of vengeance — the tale is honest, and so was she — but you cannot swear vengeance upon weather. She had thought of rescue — the name won back, the stream restored — but what is gone from every breath is gone, and an oath sworn against the truth is only a loud way to break your heart. What was left? The water, going down bright and coming up bright, had been showing her all winter.

The turning was left. Only, and entirely, the turning.

"What I tend returns," she said. And then — because the water goes down and comes up, and dusk comes round and round, and a circle was the only shape she could find with no despair hidden anywhere in it — "What returns, I tend."

She felt about the oath for its end, the way you feel along a wall for a door in the dark, and found none, and was glad: she had built it so. Every oath she knew ran to some finish — till the war is won, till death — and an end in an oath is a door left open for the weather. Hers had no door. It bound her the way you love someone: not toward a finish; around, and around. It weighed, she said afterward, what a full lantern weighs: something, always; too much, never.

That is the Keeper's Oath. She who swore it first is called the First Keeper, and every keeper since has knelt at some water or other and said the same eight words.

She had not been alone at the rim, though she had heard no one come. At the clearing's edge stood a lean, ink-marked woman who had spent the grey years walking the Fade's hem and writing down the lost — the only mourning she knew. When the Oath was sworn, she came forward and wrote it out fair, once, on a clean leaf. The First Keeper asked whether the page would hold it. The woman looked up. Then she bent again, and wrote, small, beneath the Oath: *Read it aloud.*

It is the only thing the First Clerk is known ever to have said, and she did not say it. A page is not a keeping. A page is where the words wait for a breath.

Then she went out into the world by the long way, and the long way was the point: at every hearth she taught the feeding of lanterns, the trimming of wicks, and the Oath, whole, for any who wanted it. Those who swore it were called keepers. She ended every visit at the door, lantern raised: "Onward." Keepers say it still. It means: the tending continues, and the continuing is the whole of the news, and the news is good.

Around the wellspring, keepers settled; that was the First Hamlet, and it grew as a hamlet should: slowly, and around a fire. They raised a hearth-house and swore the hearth as she had sworn the Oath — circular, doorless, fed at dusk and at waking, never once dark between. The unbroken hearth. Any keeper in from the grey could sit at it unasked, and it mended what it could: cold first; the rest as it may.

A factor set out her scales in that hamlet — the first Factor — and weighed worth strangely, and rightly: not by heft or shine, but by held light. On her scales a battered spoon, named daily in a living kitchen, outweighed a crown out of a sealed chest. She was thought mad for a season, then thought over, then thought right. *Worth is held light,* she would say. *The rest is weight.*

And in those years came the custom of the passing: when a keeper felt their own dusk coming, they gathered ears close and spoke their held lines into younger breath, the whole holding handed on warm. A good passing was counted a good death. Set this custom by your heart's door. Canto five will knock at it.

Late in her life a young keeper asked her — old by then, and still trimming the spring's dusk-lantern herself, no one else being trusted to do it properly — "When is it done?"

She laughed — an old woman's laugh with a whole winter's worth of warm in it. "It is not done. It is never done. That is the mercy of it. Endings are what losses have. A tended thing does not end — it only comes round again."

> *What I tend returns. What returns, I tend.*
> *So runs the spring, and so I swear:*
> *no end was said, for there is no end —*
> *only the turning of the year,*
> *only the wick, the flame, the friend.*
> *Carry it gladly. Begin again.*`,
  },
  {
    id: 'canto-5',
    roman: 'V',
    title: 'The Sundering of the Warden',
    body: `Here the tellers slow down and mend the fire, for the tale now turns sad in the particular way that wants the fire mended first. And they begin it, every one of them, with the same words:

No one loved the lines like the Warden.

Carry that in front of you the whole way, like a lantern on a dark stair. It is not the excuse. It is the tragedy.

He came to the wellspring young, in the First Keeper's later years, and swore the eight words, and meant them as few have meant anything. His gift was past argument: the deepest holding of his age, more lines than three keepers together, and the tale knows not one he ever lost. Children brought him cracked rhymes the way you bring the tinker a bent hinge, and he handed them back whole. And when word came of a keeper dying un-passed, too far for any younger breath, it was the Warden who rode. Any distance. Any weather.

One autumn a keeper of the coast roads fell ill out of season, and the Warden rode: three days, two rivers, the third in flood, his own crossing built in the rain sooner than wait. He came up her lane and knew from the stillness of the windows that he was late — by less than half a night, the neighbors reckoned.

Whatever of her holding no other breath shared went down with her — among it her grandmother's morning-song, the one that called mild weather in off the sea; he had once asked her to pass it early, for safekeeping, and she had told him, kindly, that passings were for dusk, and hers was a long way off yet.

At the graveside, others wept. The Warden measured: he took the measure of breath itself, and marked it down a leaking vessel. He said little for a season. When he spoke again, it was a mourner's question:

"We house the child. We roof the harvest. We wall the well against the frost. Only the lines — the trueness of the world, the thing all the rest of it stands upon — only these we ask to sleep out of doors: in breath, which fails; in memory, which tires; in keepers, who die on the wrong side of rivers. I have knelt at more passings than any man living, and I tell you the custom is a rope bridge in a rising wind. Love is not a roof. I mean to build the roof."

It is not a madman's speech. It is the best man in the room at the worst hour of his life — and nothing else has ever endangered the world half so much.

So rose the Vaults.

He raised them first in the far provinces, where the grey pressed hardest — that too was love. Stone-rooted, iron-shut, dry, still, weatherless: halls of rooms, provinces of halls. The finest gatewright of the age hung the gates himself — iron doors so justly made they closed like a held breath.

And the world came gladly to lay its burdens down. An old woman spoke her whole life's holding into the vault-stillness, heard the gate shut soft upon it, and slept the whole night through for the first time in thirty years. Set that down honestly: it was relief. The heresy was not driven with whips; it was bought with rest, from tired, good people three generations ground. It was the lord's old wish — the lamp you may stop loving — back with clean hands and a better argument. You would have stood in that line too.

The First Keeper came to him while the iron was still bright — old now, the road dear, spent on him anyway. Their talk is mostly lost; three lines are kept, and three are enough.

She said: "A sealed line is an unheld line with better walls."

He said: "Until the weather turns."

And she said: "Oh, love. We are the weather turning."

They did not part in anger. They parted the way a river parts at an island — meaning to meet again on the far side, and never quite doing it.

Province upon province, the gates went shut, each closing with a sound like the end of a sentence. When the last was barred, the world stood quieter than it had stood since before the Speaking. For a while, folk mistook the quiet for peace.

For the Fade was never a wind, that walls could turn it. The Fade is what happens where speaking stops — and what is a vault? A place where speaking has been made to stop perfectly. With all his love and all his craft, the Warden had built a great quiet; and quiet is the Fade's own country. He had not walled the weather out. He had roofed it in. Nothing howled. The sealed provinces simply greyed at the edges, while inside the iron dark, at the pace of all weather, the unspoken lines began to forget themselves.

There came a day — the tale does not date it — when he went down alone and unbarred the first vault, the oldest, to see.

In that vault, laid in first like a cornerstone, was his own dearest line: the one his mother had given him for the dark when he was small, the first line he ever held. He had sealed it as tribute, the way you set the best stone deepest. He had not spoken it in twelve years. He had thought, precisely, that he would never need to again. That had been the whole idea of everything.

In the dark beyond the door, something rose, and turned to him, and knew him — the way a hearth knows the shape of its family even when the fire is out. And it hummed. No words — words were what it had *been.* But the cadence was whole — the rise, and the little fall, and the rise again — the exact shape of his mother's line, offered back to the only face it remembered, the only lullaby it had left.

And the Warden — the deepest holding of his age, the man who never lost a line — reached within himself for the words to finish it.

And found the shape of where they had been.

He had sealed it, and so he had ceased to hold it, and so it was gone from him. It had been sealed, and so no breath renewed it, and so it was gone from itself. Man and line, they had kept nothing of each other but the outline. That is the Sundering — not the gates. A sundering of keeper from kept. It happened in one doorway, in the time a grain takes to fall; and nothing in this tale is worse, and nothing was meant better.

What the vaults hold now, keepers call the Dim. Carry one thing out of this canto: do not hate them. Nothing in a vault ever chose. The small truths — stream-names, star-names, third verses — thinned into wisps, glimmers that drift toward any spoken word the way cold hands drift toward a fire. The deep loved lines became wraiths: words gone, cadence whole, leaning close to any keeper who enters, humming their own shapes over and over — not to harm; to be finished. But longing that old has weight, and such weight can smother an unready breath. And the truths of craft kept the doing and lost the deed: constructs — armor of habit walking its rounds, sentries in perfect order guarding the inside of a lock. The Dim is not an army. It is what devotion looks like after the devoted thing is gone.

He shut that vault as softly as you shut a sickroom door, and never said what he had found. He could not have: in all his life of holding every line given him, he had never once made a line for his own sorrow. Some men are built with no door on that room; and what is never spoken cannot be kept, and what cannot be kept cannot be shared, and what cannot be shared must be stood, alone, at a gate. He did not admit the funeral. He appointed himself its watchman — and from that watch he bears the only name we have for him.

He drew the last lines of his own holding about himself and sealed them — the final vault, the one he wears: plate over plate of held truth, shield within shield. And he took his stand at the last gate, the outermost, and set the single law he has never broken: none pass but those who can speak a line truly.

"Attest it," he says — to any who come; the tale says he says it still. Not the page's version. Not hearsay's. The line itself, whole, from your own held breath — or turn around, and go home.

And here is the sorrow beneath the sorrow: he asks because he cannot. Sealed behind his own shields, the man who held the most now holds nothing he can reach — the keeper of the last gate could not pass his own trial. Every line spoken true at his gate is a grain of light through the shield-seam, the only warmth that reaches him. The trial was never aimed at you. Every *attest it* has meant, underneath: *say it lives. Say something still lives. I cannot hear it from in here.*

The First Keeper went to him once more, at the end — very old, her last road, spent so by choice. Whether to try the gate, or to turn him, or only to see his face again, the tale does not know; I think she did not either. Last roads are mostly like that.

At the gate he demanded of her what he demands of everyone — even of her, that face above all faces. It was not cruelty. By then, *attest it* was all his speech: demand and greeting, grief and please, in the one word.

She spoke the only line she had never once let cool. You know it. Eight words, sworn at a spring — given whole, from her own breath, to the man who had sworn it too, young, before any iron went up. And the outermost shield gave way; attested truth is the one key that gate has ever answered. Hammer has been tried, and fire, and years. The shields know only a held line, spoken true.

Beyond the opened shield stood gates, and beyond those more — provinces of shut iron going back into the grey, further than lifetimes. One line, one gate. She stood a long grain in the doorway, measuring that country against one old woman and one evening. It was not a labor for a keeper, nor an age of keepers. It was the kind no one finishes — the kind one only begins well.

She did not go in. One thing was hers to do, and she did it. She trimmed the wick of the first lantern — the tin one, more mending than metal, that had lit the Wright's bench and her winter at the wellspring — and fed it the oldest line she carried: a crossing-song worn smooth on a river at the beginning of this tale. And she set it down burning at the last gate, on the outside, where the living road ends.

"When you tire of asking, friend," she said to the shields, "follow the light out. It knows the way home. It has never once been lost."

And from behind the iron — the only time, in all the tellings, that the Warden says any other thing — quiet, half swallowed, in the voice of a man reaching for a line he never made:

"Tell them—"

She waited. The dusk came down, and the rest of it never came. He had never made that line; and what is never spoken cannot be kept, and what is not kept cannot be found in the hour of its wanting — not even by the Warden. Especially not by the Warden.

She went home slowly, and told all of it, and died in the spring of the year at the unbroken hearth, her lines passing warm into younger breath, every last one — a good passing, the best the custom ever made. The tale does not linger, or we would weep.

The first lantern burns at the last gate yet. Keepers who walk that far road feed it as they pass — the oldest duty on any road, and the sweetest, and not for the vaults' sake. Ask any keeper who has fed the old tin lamp and watched the gold stand up in it: they will tell you for whom the light is kept.

And the Gatewright walked home, past his own finest work, without the heart to look at it. A builder grieves in the craft: he could not stop hanging gates. But every gate he hung thereafter, he cut a question into the lintel and taught the watch to ask it aloud at dusk: *Who goes, and what do you carry?* So that on all his roads, no traveler would pass an evening without saying their own name aloud — you see what he was mending. "A wall is an answer," he would say, hanging the next one. "A gate is a question." He had built the greatest answer in the world, and he meant to spend the rest of his life asking.

> *Who loved the lines like the Warden?*
> *No one. That is the sorrow.*
> *He walled his loves in from the weather*
> *and walled himself from tomorrow.*
> *He asks at the gate because he cannot answer —*
> *answer him kindly, and answer him true.*`,
  },
  {
    id: 'canto-6',
    roman: 'VI',
    title: 'The Long Dimming',
    body: `Ages are quick to say and long to live. Say "ages" now, and then live them as the world did: dusk by dusk, each one a little more used to itself than the last.

The sealed provinces greyed like an unworn coat on its peg. The grey did not march; it settled. Hamlets drew in close around their keepers and hearths, as hands draw in around a struggling flame; and the Ledger grew thin — not torn: thin, as cloth grows thin, at the elbows first, where the world had once done its reaching.

But the welds held. Say it whenever the tale grows heavy: the welds held. The law of falling, the roundness of rain, the sun's road home — held by the world entire, past all weather; on these the house of things stood, and stands. Whatever else the ages took, there was a morning every morning. There will always be a morning.

What the ages took was stranger than things: the ages took the noticing. The Fade's cruelest work was never the taking — it was teaching the world to call the grey *the way things are.* Children grew up under a low sky and loved it, as children love whatever is theirs; elders who remembered brighter were heard the way you hear a grandmother gilding her girlhood. The world forgot that it was forgetting. That is the deepest thing the weather ever did, so the tale says it twice: the world forgot that it was forgetting.

And the old crafts wore down into ornaments — but mark each one, for nothing in this canto is only sad.

Lanterns hung at every door still: bought bright, hung proud, fed never. Ask what a lantern was for and most would say: for pretty. One man kept forty on his walls, spoke to none, and was called a great friend of light. But at dusk someone still went along the lanes with a taper — and if the someones no longer knew why they murmured to each wick, they murmured all the same. The feeding survived as manners. Much survives as manners, if you will only keep the manners.

The old held lines that lived through those ages did it by hiding inside the telling: they became stories. *Fables,* folk called them — which is what a truth is called once no one remembers it is true. They were told at bedsides for pleasure, and the pleasure kept them breathing; and so, smuggled inside delight, a thousand true lines rode out the ages in the mouths of tale-tellers who would have laughed to be called keepers.

The Oath itself went to the children — usually told as the fall; this fire will not tell it so. The words were too good to lose and too heavy to carry, so the world gave them to the skipping-rope. Dusk after dusk the rhyme went round, gathering the old crafts into itself as a river gathers rain: *trim the wick, feed the flame, tell the gate your own true name.* No child knew what they carried; no child ever needs to. Said aloud, daily, by the faithful small — who never miss a dusk — the Oath rode the ages more safely than ever it would have done in iron. The Fade has never caught a skipping rhyme. It never will.

As for the page — the Clerk's fair copy — it outlived its shelf, its house, its province, and came at last to a careful man who knew old inks. He read the eight words, and beneath them the three small ones. He read all eleven silently, and filed it. The tale does not mock him; pages must be kept dry, and he kept it dry fifty years. But you have the advantage of him forever, simply by sitting at this fire while these words go by aloud. The page serves the breath. The Clerk, wherever she keeps her office now, may mark her instruction: carried out.

And on the far road, all those ages, the first lantern burned; the duty never lapsed; someone always came in time. Some who fed it no longer rightly knew for whom the light was kept, and fed it anyway — which may be the purest feeding there is. And of stubborn tendings like that one, the folk of those ages kept a saying, half a sigh and half a vow. They would shrug, and smile a little, and say: *until the weather turns.*

They did not remember whose words they were keeping. The words remembered. Words are like that, if you will only keep saying them.

> *Round and round the rhyme goes.*
> *Nobody knows what the rhyme knows.*
> *The wise wrote it fair, and the fair page fell;*
> *the children caught it and kept it well.*
> *Grey at the edges, gold at the hearth —*
> *sing it again. It is only a rhyme.*`,
  },
  {
    id: 'canto-7',
    roman: 'VII',
    title: 'The Hamlet at the Wood\'s Heart',
    body: `Walk any road long enough — and you have, to be hearing this — and the land leans, the trees close kindly overhead, and around the last bend you come to a wood with a hamlet at its heart.

Maps that trouble to name it call it Fablewood. Most folk just say home.

It is dusk when you arrive; it is usually dusk here, the good kind, violet going to peach above the rooftops. Pools of gold stand along the lanes, every lantern lit — someone goes along with a taper and a murmured word for every wick. It is no one's task. Someone always does it.

At the south gate the gatewarden is setting the bar, and before it drops he asks the dark road his question — *Who goes, and what do you carry?* — and waits three breaths, out of courtesy, in case the dark should finally answer. It never has. He asks anyway. The habit came down with the office, older than he knows — which is exactly how the oldest things travel.

At her stall the factor turns some piece of nothing by lantern-light — tonight a cracked wooden spoon somebody's child brought her — finding the shine in the worn place where a thumb rested forty years. Folk shake their heads. She says her scales are older than theirs, and leaves it at that.

In the office of records the clerk is at her desk; she is always at her desk. She writes everything down — dusks, frosts, who mended what — and nobody reads a word, and she knows it. A traveler once asked her, kindly, why she kept records no one read. She looked at him for a long grain — long enough that he began apologizing — then wrote the question down. And dated it.

At the inn the fire is fed. It has not gone out in the memory of the living, nor of the folk the living remember. The innkeeper feeds it at dusk and at waking, and will tell you a fed fire is a friendly one, and this one mends folk who sit still long enough to let it. Ask how old it is and she laughs: fires don't have birthdays. Some fires are older than their houses. That is all the tale will say.

And past the little stone bridge is a well the children call the wishing-well. At dusk its water is bright — softly, from below — and the children tell it what they want most, as their grandmothers did. It is not a wishing-well. The oldest folk, correcting no one, call it the wellspring. It has never minded the smaller name. Water is patient, and it remembers with you.

The children are at their rope as the lanterns come on: *trim the wick, feed the flame, tell the gate your own true name.* There is a last verse, hard to skip to — the rope always catches in the middle — so the children mostly leave it off, and the old folk mostly don't. It promises nothing grand: no brightest dawn, no greatest keeper, no end of grey weather. It is the smallest promise the world has ever kept on making.

Sit down, then. The fire is fed, and there is always room by it. Listen while the old folk finish the rhyme. It goes this way:

> *Trim the wick and feed the flame;*
> *tell the gate your own true name;*
> *round and round, begin again —*
> *and when the wick is trimmed, and the gate is asked its question,*
> *a keeper comes — not the greatest,*
> *only the next.*`,
  },
];
