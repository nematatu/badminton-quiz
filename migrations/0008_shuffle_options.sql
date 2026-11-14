-- 選択肢の順番を回答者（挑戦）ごとに入れ替えるか。再挑戦で「答えは B だった」と位置を覚えて
-- 解けてしまうのを防ぐ。「上記すべて」のように順番に意味がある選択肢もあるので、クイズごとの任意設定。
ALTER TABLE quizzes ADD COLUMN shuffle_options INTEGER NOT NULL DEFAULT 0 CHECK (shuffle_options IN (0, 1));
