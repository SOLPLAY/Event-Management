from couchbase.exceptions import DocumentNotFoundException

from .connection import get_cluster, get_collection


def get_event(event_id: str):

    collection = get_collection()

    try:
        result = collection.get(event_id)

        return result.content_as[dict]

    except DocumentNotFoundException:
        return None


def get_events():

    cluster = get_cluster()

    query = """
        SELECT e.*
        FROM `ngdb`.`event_management`.`events` AS e
        ORDER BY e.date
    """

    result = cluster.query(query)

    events = []

    for row in result.rows():
        events.append(row)

    return events