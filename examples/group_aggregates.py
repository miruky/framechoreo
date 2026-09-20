"""Average a rating column and count how many reviews actually carried a rating.

group_count reports non-missing entries per group, not the row count: two products
have three reviews each, but one review per product left the rating blank.
"""

from pathlib import Path

import pandas as pd

from framechoreo import DataStory


def reviews_table(story: DataStory):
    return story.table(
        pd.DataFrame(
            {
                "product": ["P1", "P1", "P1", "P2", "P2", "P2"],
                "rating": pd.Series([5, 4, None, 3, None, 2], dtype="Int64"),
            }
        ),
        name="Reviews",
    )


if __name__ == "__main__":
    mean_story = DataStory(title="Average rating by product")
    reviews = reviews_table(mean_story)
    average = reviews.group_mean(
        by="product", value="rating", dropna=False, label="Average rating per product"
    )
    mean_story.annotate(average, note="A missing rating is skipped, not treated as zero.", hold=4)
    mean_path = mean_story.export_html(
        Path(__file__).parent / "generated" / "group-mean.html",
        result=average,
        overwrite=True,
    )
    print("Average rating:", average.to_pandas()["rating"].tolist())
    print("Wrote", mean_path)
    assert average.to_pandas()["rating"].tolist() == [4.5, 2.5]

    count_story = DataStory(title="Reviews that actually carry a rating, by product")
    reviews = reviews_table(count_story)
    rated = reviews.group_count(
        by="product", value="rating", dropna=False, label="Count of reviews with a rating"
    )
    count_story.annotate(
        rated, note="This counts non-missing ratings, not the number of reviews.", hold=4
    )
    count_path = count_story.export_html(
        Path(__file__).parent / "generated" / "group-count.html",
        result=rated,
        overwrite=True,
    )
    print("Rated review count:", rated.to_pandas()["rating"].tolist())
    print("Wrote", count_path)
    assert rated.to_pandas()["rating"].tolist() == [2, 2]
